import {
  STATE_NAMES,
  completeSetup,
  daySummary,
  outstanding,
  stockStatus,
  currentSchemaVersion,
  financialYearOn,
  backupReminder,
  getCompany,
  getSetting,
  isSetupComplete,
  listUsers,
  login,
} from '@shopledger/core';
import { backupProblem } from '../backup.ts';
import type { Handlers, HandlerContext } from '../ipc.ts';
import type { SessionState } from '../../ipc/contract.ts';

export function sessionState(ctx: Omit<HandlerContext, 'user'>): SessionState {
  const fy = financialYearOn(ctx.db, ctx.today());
  return {
    setupComplete: isSetupComplete(ctx.db),
    financialYear: fy ? { startDate: fy.startDate, endDate: fy.endDate, label: fy.label } : null,
    user: ctx.session.user,
    today: ctx.today(),
    company: getCompany(ctx.db) ?? null,
  };
}

export const sessionHandlers: Pick<
  Handlers,
  | 'app.info'
  | 'session.state'
  | 'setup.complete'
  | 'auth.users'
  | 'auth.login'
  | 'auth.logout'
  | 'lookup.states'
  | 'home.summary'
> = {
  'app.info': (_req, ctx) => ({
    dbPath: ctx.dbPath,
    schemaVersion: currentSchemaVersion(ctx.db),
  }),
  'session.state': (_req, ctx) => sessionState(ctx),
  'setup.complete': (req, ctx) => {
    const ownerId = completeSetup(ctx.db, {
      company: {
        name: req.shopName,
        address: req.address,
        stateCode: req.stateCode,
        gstin: req.gstin,
        phone: req.phone,
      },
      ownerName: req.ownerName,
      ownerPin: req.ownerPin,
      today: ctx.today(),
    });
    const owner = listUsers(ctx.db).find((u) => u.id === ownerId)!;
    ctx.session.user = { id: owner.id, name: owner.name, role: owner.role };
    return sessionState(ctx);
  },
  'auth.users': (_req, ctx) =>
    listUsers(ctx.db)
      .filter((u) => u.isActive)
      .map((u) => ({ id: u.id, name: u.name })),
  'auth.login': (req, ctx) => {
    const user = login(ctx.db, req.name, req.pin);
    ctx.session.user = { id: user.id, name: user.name, role: user.role };
    return sessionState(ctx);
  },
  'auth.logout': (_req, ctx) => {
    ctx.session.user = null;
    return sessionState(ctx);
  },
  'lookup.states': () =>
    Object.entries(STATE_NAMES)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  'home.summary': (_req, ctx) => {
    const today = ctx.today();
    const day = daySummary(ctx.db, { date: today });
    const sales = day.byType.find((t) => t.voucherType === 'sales');
    const receivable = outstanding(ctx.db, { asOn: today, side: 'receivable' });
    return {
      todaySalesPaise: sales?.totalPaise ?? 0,
      todayBills: sales?.count ?? 0,
      cashInHandPaise: day.cashClosingPaise,
      toCollectPaise: receivable.reduce((t, p) => t + p.outstandingPaise, 0),
      lowStockItems: stockStatus(ctx.db, { asOn: today, onlyProblems: true }).rows.length,
      backupWarning:
        backupProblem(ctx.db) ?? backupReminder(getSetting(ctx.db, 'backup.last_at'), today),
    };
  },
};
