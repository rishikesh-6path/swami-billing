import {
  IMPORT_SAMPLES,
  ValidationError,
  importItemsCsv,
  importPartiesCsv,
  changePin,
  checkBackupFile,
  closeDay,
  closeFinancialYear,
  createUser,
  dayClosedThrough,
  booksLockedThrough,
  financialYearOn,
  getCompany,
  getSetting,
  listFinancialYears,
  listUsers,
  lockBooks,
  reopenDay,
  saveCompany,
  setSetting,
  unlockBooks,
  updateUser,
  type Db,
} from '@shopledger/core';
import type { ShopSettings } from '../../ipc/contract.ts';
import { backupStatus, runBackup, setBackupFolder } from '../backup.ts';
import type { HandlerContext, Handlers } from '../ipc.ts';

const books = (db: Db): ShopSettings['books'] => ({
  dayClosedThrough: dayClosedThrough(db) ?? null,
  lockedThrough: booksLockedThrough(db) ?? null,
});

function years(ctx: HandlerContext): ShopSettings['years'] {
  const current = financialYearOn(ctx.db, ctx.today());
  return listFinancialYears(ctx.db).map((y) => ({ ...y, current: y.id === current?.id }));
}

const audit = (ctx: HandlerContext) => ({ userId: ctx.user().id });

export const settingsHandlers: Pick<
  Handlers,
  | 'settings.get'
  | 'settings.saveCompany'
  | 'settings.savePrint'
  | 'users.list'
  | 'users.create'
  | 'users.update'
  | 'users.changePin'
  | 'books.closeDay'
  | 'books.reopenDay'
  | 'books.lock'
  | 'books.unlock'
  | 'books.closeYear'
  | 'import.run'
  | 'import.sample'
  | 'backup.status'
  | 'backup.run'
  | 'backup.chooseFolder'
  | 'backup.check'
  | 'backup.restore'
> = {
  'settings.get': (_req, ctx) => ({
    company: getCompany(ctx.db) ?? null,
    print: {
      printer: getSetting(ctx.db, 'print.printer') ?? '',
      size: getSetting(ctx.db, 'print.size') === 'thermal' ? 'thermal' : 'a4',
      auto: getSetting(ctx.db, 'print.auto') === '1',
    },
    books: books(ctx.db),
    years: years(ctx),
  }),
  'settings.saveCompany': (req, ctx) => saveCompany(ctx.db, req, audit(ctx)),
  'settings.savePrint': (req, ctx) => {
    setSetting(ctx.db, 'print.printer', req.printer.trim());
    setSetting(ctx.db, 'print.size', req.size);
    setSetting(ctx.db, 'print.auto', req.auto ? '1' : '0');
    return null;
  },
  'users.list': (_req, ctx) => listUsers(ctx.db),
  'users.create': (req, ctx) => {
    createUser(ctx.db, req, audit(ctx));
    return listUsers(ctx.db);
  },
  'users.update': (req, ctx) => {
    const { id, ...patch } = req;
    if (id === ctx.user().id && (patch.isActive === false || patch.role === 'staff')) {
      throw new ValidationError(
        'You cannot take away your own access. Ask another owner to do this.',
      );
    }
    updateUser(
      ctx.db,
      id,
      {
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
      audit(ctx),
    );
    return listUsers(ctx.db);
  },
  'users.changePin': (req, ctx) => {
    changePin(ctx.db, req.id, req.pin, audit(ctx));
    return null;
  },
  'books.closeDay': (req, ctx) => {
    closeDay(ctx.db, req.date, audit(ctx));
    return books(ctx.db);
  },
  'books.reopenDay': (req, ctx) => {
    reopenDay(ctx.db, req.date, audit(ctx));
    return books(ctx.db);
  },
  'books.lock': (req, ctx) => {
    lockBooks(ctx.db, req.date, audit(ctx));
    return books(ctx.db);
  },
  'books.unlock': (_req, ctx) => {
    unlockBooks(ctx.db, audit(ctx));
    return books(ctx.db);
  },
  'books.closeYear': (req, ctx) => {
    closeFinancialYear(ctx.db, req.fyId, audit(ctx));
    return years(ctx);
  },
  'import.run': async (req, ctx) => {
    const file = await ctx.chooseCsv();
    if (!file) return { cancelled: true, fileName: '', created: 0, skipped: [] };
    const result =
      req.kind === 'items'
        ? importItemsCsv(ctx.db, file.text)
        : importPartiesCsv(ctx.db, file.text, req.kind === 'suppliers' ? 'supplier' : 'customer');
    return { cancelled: false, fileName: file.name, ...result };
  },
  'import.sample': async (req, ctx) => ({
    saved: await ctx.saveText(`sample-${req.kind}.csv`, `${IMPORT_SAMPLES[req.kind]}\n`),
  }),
  'backup.status': (_req, ctx) => backupStatus(ctx.db, ctx.backupPlace),
  'backup.run': (_req, ctx) => {
    const clock = ctx.clock();
    const { copied } = runBackup(ctx.db, ctx.backupPlace, clock.date, clock.time);
    return { ...backupStatus(ctx.db, ctx.backupPlace), copied };
  },
  'backup.chooseFolder': async (req, ctx) => {
    if (req.clear) {
      setBackupFolder(ctx.db, req.which, null);
    } else {
      const folder = await ctx.chooseFolder(
        req.which === 'main'
          ? 'Choose the folder where backups are kept'
          : 'Choose the drive or folder for the second copy',
      );
      if (folder) setBackupFolder(ctx.db, req.which, folder);
    }
    return backupStatus(ctx.db, ctx.backupPlace);
  },
  'backup.check': async (req, ctx) => {
    const path = req.path ?? (await ctx.chooseBackupFile());
    if (!path) return null;
    return { ...checkBackupFile(path), path };
  },
  'backup.restore': (req, ctx) => {
    ctx.restoreFrom(req.path);
    return { restarting: true as const };
  },
};
