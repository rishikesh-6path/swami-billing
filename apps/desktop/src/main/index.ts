import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, session as electronSession } from 'electron';
import {
  ValidationError,
  checkBackupFile,
  createBackup,
  restoreDatabaseFile,
  seedDemoShop,
} from '@shopledger/core';
import {
  backupFolder,
  defaultBackupFolder,
  dueSlot,
  backupBusy,
  markBackupFailed,
  runBackup,
  settleBackups,
} from './backup.ts';
import { testKnob } from './env.ts';
import { log } from './log.ts';
import { openShopDatabase, type OpenedDatabase } from './database.ts';
import { handlers } from './handlers/index.ts';
import { registerHandlers, type Session } from './ipc.ts';

// E2E isolation: must be set before the single-instance lock is requested.
const userDataOverride = testKnob('SHOPLEDGER_USER_DATA');
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

/** Writes a file the user asked for; a file left open in Excel or a full disk gets a plain message. */
function writeSafely(path: string, data: string | Uint8Array): void {
  try {
    writeFileSync(path, data);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new ValidationError(
        'That file could not be saved. If it is open in Excel or another program, close it and try again.',
      );
    }
    if (code === 'ENOSPC') {
      throw new ValidationError(
        'There is no space left on the disk. Please free some space and try again.',
      );
    }
    throw error;
  }
}

let mainWindow: BrowserWindow | null = null;
let shopDb: OpenedDatabase | null = null;
let quitBackup: (() => Promise<void>) | null = null;
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'ShopLedger',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // The app is fully offline: never open new windows or navigate away from the bundle.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (!(devUrl && url.startsWith(devUrl))) event.preventDefault();
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // the window may already be gone while the closing backup finishes
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // The shop PC opens ShopLedger when Windows starts, so billing is never blocked by a closed app.
    if (app.isPackaged && process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    // The app never needs the camera, location, notifications and so on: refuse every request.
    electronSession.defaultSession.setPermissionRequestHandler((_contents, _permission, done) =>
      done(false),
    );
    // No menu bar in the shop: its shortcuts (F5 reload, Ctrl+R, zoom, developer tools) must never
    // fire by accident while staff are typing bills. Developers keep the default menu.
    if (!process.env['ELECTRON_RENDERER_URL']) Menu.setApplicationMenu(null);
    try {
      shopDb = openShopDatabase();
    } catch (error) {
      log('error', 'could not open the data file', error);
      dialog.showErrorBox(
        'ShopLedger cannot open your shop data',
        'Your data file could not be opened, so ShopLedger will close now. ' +
          'Please do not enter any bills. Call support and tell them about this message. ' +
          'Your data has not been changed.',
      );
      app.quit();
      return;
    }
    const opened = shopDb;
    const session: Session = { user: null };
    // Business dates are Indian dates; tests can pin the date with SHOPLEDGER_TODAY.
    const today = () =>
      testKnob('SHOPLEDGER_TODAY') ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const clock = () => ({
      date: today(),
      time: new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date()),
    });
    const backupPlace = { defaultFolder: defaultBackupFolder(app.getPath('userData')) };
    // Demo mode (development and automated tests only): load a sample shop into an empty database.
    if (testKnob('SHOPLEDGER_DEMO') === '1') {
      const empty = opened.db.prepare('SELECT COUNT(*) AS n FROM user').get()?.['n'] === 0;
      if (empty) seedDemoShop(opened.db, { today: today() });
    }
    // Exports go where the user chooses. Tests set SHOPLEDGER_EXPORT_DIR to skip the dialogs.
    const exportDir = testKnob('SHOPLEDGER_EXPORT_DIR');
    const saveText = async (defaultName: string, content: string) => {
      if (exportDir) {
        mkdirSync(exportDir, { recursive: true });
        const path = join(exportDir, defaultName);
        writeSafely(path, content);
        return path;
      }
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: 'Save report',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return null;
      writeSafely(result.filePath, content);
      return result.filePath;
    };
    const saveFiles = async (files: Record<string, string>, subfolder: string) => {
      let folder = exportDir;
      if (!folder) {
        const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
          title: 'Choose a folder to save the files in',
          defaultPath: app.getPath('documents'),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        folder = result.filePaths[0];
      }
      // one folder per period, so a new month never overwrites last month's files
      const target = join(folder, subfolder.replace(/[^A-Za-z0-9._-]+/g, '-'));
      mkdirSync(target, { recursive: true });
      for (const [name, content] of Object.entries(files)) writeSafely(join(target, name), content);
      return target;
    };
    // Bills are rendered in a hidden window and printed from there, so the app window is untouched.
    const withHiddenPage = async <T>(
      html: string,
      use: (win: BrowserWindow) => Promise<T>,
    ): Promise<T> => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, javascript: false },
      });
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await use(win);
      } finally {
        win.destroy();
      }
    };
    const pageSize = (size: 'a4' | 'thermal') =>
      size === 'a4' ? ('A4' as const) : { width: 80_000, height: 297_000 };
    const printHtml = (
      html: string,
      opts: { size: 'a4' | 'thermal'; printerName?: string | undefined },
    ) => {
      // automated tests have no printer: keep the page as a file instead of opening a print window
      if (exportDir) {
        mkdirSync(exportDir, { recursive: true });
        writeSafely(join(exportDir, `printed-${Date.now()}.html`), html);
        return Promise.resolve(true);
      }
      return withHiddenPage(
        html,
        (win) =>
          new Promise<boolean>((resolve) => {
            win.webContents.print(
              {
                silent: Boolean(opts.printerName),
                ...(opts.printerName ? { deviceName: opts.printerName } : {}),
                printBackground: true,
                pageSize: pageSize(opts.size),
              },
              (success) => resolve(success),
            );
          }),
      );
    };
    const writePdf = async (pdf: Buffer, defaultName: string) => {
      if (exportDir) {
        mkdirSync(exportDir, { recursive: true });
        const path = join(exportDir, defaultName);
        writeSafely(path, pdf);
        return path;
      }
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: 'Save as PDF',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return null;
      writeSafely(result.filePath, pdf);
      return result.filePath;
    };
    const savePdf = async (html: string, opts: { size: 'a4' | 'thermal'; defaultName: string }) => {
      // printToPDF takes custom sizes in inches (print() takes microns).
      const pdfPageSize =
        opts.size === 'a4' ? ('A4' as const) : { width: 80 / 25.4, height: 297 / 25.4 };
      const pdf = await withHiddenPage(html, (win) =>
        win.webContents.printToPDF({ printBackground: true, pageSize: pdfPageSize }),
      );
      return writePdf(pdf, opts.defaultName);
    };
    /** Saves the report on the screen as a landscape A4 PDF, as it would print (no buttons). */
    let savingPage = false;
    const savePagePdf = async (defaultName: string) => {
      if (!mainWindow || savingPage) return null;
      savingPage = true;
      try {
        return await savePagePdfNow(mainWindow, defaultName);
      } finally {
        savingPage = false;
      }
    };
    const savePagePdfNow = async (win: BrowserWindow, defaultName: string) => {
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        landscape: true,
      });
      return writePdf(pdf, defaultName);
    };
    const chooseFolder = async (title: string) => {
      if (exportDir) return exportDir;
      const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        title,
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    };
    const chooseCsv = async () => {
      // tests point this at a prepared file instead of opening the file window
      const fixed = testKnob('SHOPLEDGER_IMPORT_FILE');
      let path = fixed ?? null;
      if (!path) {
        const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
          title: 'Choose your spreadsheet (CSV file)',
          defaultPath: app.getPath('documents'),
          filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv', 'txt'] }],
          properties: ['openFile'],
        });
        path = result.canceled ? null : (result.filePaths[0] ?? null);
      }
      if (!path) return null;
      const text = readFileSync(path, 'utf8');
      if (text.includes('\uFFFD')) {
        throw new ValidationError(
          'Some letters in this file cannot be read. In Excel, save the sheet again as "CSV UTF-8 (Comma delimited)" and choose that file.',
        );
      }
      return { name: basename(path), text };
    };
    const chooseBackupFile = async () => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        title: 'Choose a backup file',
        defaultPath: backupFolder(opened.db, backupPlace),
        filters: [{ name: 'ShopLedger backup', extensions: ['db'] }],
        properties: ['openFile'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    };
    const restoreFrom = async (path: string) => {
      const check = checkBackupFile(path);
      if (!check.ok) {
        throw new ValidationError(
          `This backup cannot be used. ${check.message} Nothing was changed.`,
        );
      }
      // a backup may still be running: wait for it, so no worker holds the data file during the swap
      if (!(await settleBackups(30_000))) {
        throw new ValidationError(
          'A backup is still running. Please wait a minute and try the restore again.',
        );
      }
      const { date, time } = clock();
      // The current data is saved first, as "saved before a restore", so a wrong choice can be undone.
      createBackup(opened.db, backupFolder(opened.db, backupPlace), date, time, 'before-restore');
      stopBackups();
      opened.db.close();
      shopDb = null;
      let failure: unknown = null;
      try {
        restoreDatabaseFile(path, opened.path);
      } catch (error) {
        failure = error;
        log('error', 'restore failed', error);
      }
      // either way the app restarts: after a failed swap the old data file is still in place
      setTimeout(() => {
        // tests set this so the checked-out copy does not start a second app
        if (!testKnob('SHOPLEDGER_NO_RELAUNCH')) app.relaunch();
        app.exit(0);
      }, 800);
      if (failure) {
        throw failure instanceof ValidationError
          ? failure
          : new ValidationError(
              'The backup could not be put in place, so your data was not changed. ShopLedger will restart now. If this happens again, call support.',
            );
      }
    };
    // Backups: twice a day while the app is open (checked every minute), and when it closes.
    const backupNow = async (slot?: string, timeoutMs?: number) => {
      try {
        const { date, time } = clock();
        await runBackup(opened.db, backupPlace, opened.path, date, time, slot, timeoutMs);
      } catch (error) {
        log('error', 'backup failed', error);
        try {
          markBackupFailed(opened.db, clock().date, slot);
        } catch {
          // the database itself is the problem; nothing more can be recorded
        }
      }
    };
    const timer = setInterval(() => {
      try {
        const { date, time } = clock();
        const slot = dueSlot(opened.db, date, time.slice(0, 5));
        if (slot && !backupBusy()) void backupNow(slot);
      } catch (error) {
        log('error', 'backup schedule failed', error);
      }
    }, 60_000);
    const stopBackups = () => clearInterval(timer);
    quitBackup = async () => {
      stopBackups();
      // a backup as the app closes, but never more than 20 seconds, so a bad drive cannot stop the PC shutting down
      if (shopDb) await backupNow(undefined, 20_000);
    };
    const listPrinters = async () => {
      const contents = mainWindow?.webContents;
      if (!contents) return [];
      try {
        return (await contents.getPrintersAsync()).map((p) => p.name);
      } catch {
        return [];
      }
    };
    registerHandlers(ipcMain, handlers, {
      appVersion: app.getVersion(),
      listPrinters,
      backupPlace,
      clock,
      chooseFolder,
      chooseBackupFile,
      chooseCsv,
      restoreFrom,
      db: opened.db,
      dbPath: opened.path,
      session,
      today,
      saveText,
      saveFiles,
      printHtml,
      savePdf,
      savePagePdf,
    });
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    log('info', `started, version ${app.getVersion()}`);
  });

  app.on('before-quit', (event) => {
    if (quitBackup && !quitting) {
      // wait for the closing backup (it runs in the background), then quit for real
      event.preventDefault();
      quitting = true;
      const finish = quitBackup;
      quitBackup = null;
      // the closing backup may take at most 25 seconds in total, even if others are queued ahead of it
      const limit = new Promise<void>((resolve) => setTimeout(resolve, 25_000));
      void Promise.race([finish(), limit])
        .catch(() => undefined)
        .finally(() => {
          try {
            shopDb?.db.close();
          } catch (error) {
            log('error', 'closing the data file failed', error);
          } finally {
            shopDb = null;
            // exit (not quit): it also ends a backup worker that is stuck on a slow drive
            app.exit(0);
          }
        });
      return;
    }
    shopDb?.db.close();
    shopDb = null;
  });

  app.on('window-all-closed', () => app.quit());
}
