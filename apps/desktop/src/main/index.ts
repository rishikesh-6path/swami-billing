import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
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
  markBackupFailed,
  runBackup,
} from './backup.ts';
import { openShopDatabase, type OpenedDatabase } from './database.ts';
import { handlers } from './handlers/index.ts';
import { registerHandlers, type Session } from './ipc.ts';

// E2E isolation: must be set before the single-instance lock is requested.
const userDataOverride = process.env['SHOPLEDGER_USER_DATA'];
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

let mainWindow: BrowserWindow | null = null;
let shopDb: OpenedDatabase | null = null;
let quitBackup: (() => void) | null = null;

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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // The shop PC opens ShopLedger when Windows starts, so billing is never blocked by a closed app.
    if (app.isPackaged && process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: true });
    }
    // No menu bar in the shop: its shortcuts (F5 reload, Ctrl+R, zoom, developer tools) must never
    // fire by accident while staff are typing bills. Developers keep the default menu.
    if (!process.env['ELECTRON_RENDERER_URL']) Menu.setApplicationMenu(null);
    try {
      shopDb = openShopDatabase();
    } catch (error) {
      console.error('[shopledger] could not open database', error);
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
      process.env['SHOPLEDGER_TODAY'] ??
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
    if (process.env['SHOPLEDGER_DEMO'] === '1') {
      const empty = opened.db.prepare('SELECT COUNT(*) AS n FROM user').get()?.['n'] === 0;
      if (empty) seedDemoShop(opened.db, { today: today() });
    }
    // Exports go where the user chooses. Tests set SHOPLEDGER_EXPORT_DIR to skip the dialogs.
    const exportDir = process.env['SHOPLEDGER_EXPORT_DIR'];
    const saveText = async (defaultName: string, content: string) => {
      if (exportDir) {
        mkdirSync(exportDir, { recursive: true });
        const path = join(exportDir, defaultName);
        writeFileSync(path, content, 'utf8');
        return path;
      }
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: 'Save report',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, content, 'utf8');
      return result.filePath;
    };
    const saveFiles = async (files: Record<string, string>) => {
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
      mkdirSync(folder, { recursive: true });
      for (const [name, content] of Object.entries(files))
        writeFileSync(join(folder, name), content, 'utf8');
      return folder;
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
    ) =>
      withHiddenPage(
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
    const savePdf = async (html: string, opts: { size: 'a4' | 'thermal'; defaultName: string }) => {
      // printToPDF takes custom sizes in inches (print() takes microns).
      const pdfPageSize =
        opts.size === 'a4' ? ('A4' as const) : { width: 80 / 25.4, height: 297 / 25.4 };
      const pdf = await withHiddenPage(html, (win) =>
        win.webContents.printToPDF({ printBackground: true, pageSize: pdfPageSize }),
      );
      if (exportDir) {
        mkdirSync(exportDir, { recursive: true });
        const path = join(exportDir, opts.defaultName);
        writeFileSync(path, pdf);
        return path;
      }
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: 'Save as PDF',
        defaultPath: join(app.getPath('documents'), opts.defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, pdf);
      return result.filePath;
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
      const fixed = process.env['SHOPLEDGER_IMPORT_FILE'];
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
      return path ? { name: basename(path), text: readFileSync(path, 'utf8') } : null;
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
    const restoreFrom = (path: string) => {
      const check = checkBackupFile(path);
      if (!check.ok) {
        throw new ValidationError(
          `This backup cannot be used. ${check.message} Nothing was changed.`,
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
        console.error('[shopledger] restore failed', error);
      }
      // either way the app restarts: after a failed swap the old data file is still in place
      setTimeout(() => {
        // tests set this so the checked-out copy does not start a second app
        if (!process.env['SHOPLEDGER_NO_RELAUNCH']) app.relaunch();
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
    const backupNow = (slot?: string) => {
      try {
        const { date, time } = clock();
        runBackup(opened.db, backupPlace, date, time, slot);
      } catch (error) {
        console.error('[shopledger] backup failed', error);
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
        if (slot) backupNow(slot);
      } catch (error) {
        console.error('[shopledger] backup schedule failed', error);
      }
    }, 60_000);
    const stopBackups = () => clearInterval(timer);
    quitBackup = () => {
      stopBackups();
      if (shopDb) backupNow();
    };
    registerHandlers(ipcMain, handlers, {
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
    });
    mainWindow = createWindow();
    console.log('[shopledger] window created');
  });

  app.on('before-quit', () => {
    quitBackup?.();
    quitBackup = null;
    shopDb?.db.close();
    shopDb = null;
  });

  app.on('window-all-closed', () => app.quit());
}
