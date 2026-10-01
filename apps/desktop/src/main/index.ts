import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { seedDemoShop } from '@shopledger/core';
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
    registerHandlers(ipcMain, handlers, {
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
    shopDb?.db.close();
    shopDb = null;
  });

  app.on('window-all-closed', () => app.quit());
}
