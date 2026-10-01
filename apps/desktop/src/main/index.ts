import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
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
    registerHandlers(ipcMain, handlers, { db: opened.db, dbPath: opened.path, session, today });
    mainWindow = createWindow();
    console.log('[shopledger] window created');
  });

  app.on('before-quit', () => {
    shopDb?.db.close();
    shopDb = null;
  });

  app.on('window-all-closed', () => app.quit());
}
