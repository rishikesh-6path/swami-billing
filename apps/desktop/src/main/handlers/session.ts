import {
  STATE_NAMES,
  ValidationError,
  type Db,
  completeSetup,
  daySummary,
  outstanding,
  stockStatus,
  currentSchemaVersion,
  financialYearOn,
  ensureFinancialYearFor,
  backupReminder,
  heldCount,
  getCompany,
  getSetting,
  isSetupComplete,
  listUsers,
  login,
} from '@shopledger/core';
import { backupProblem } from '../backup.ts';
import { testKnob } from '../env.ts';
import type { Handlers, HandlerContext } from '../ipc.ts';
import type { SessionState } from '../../ipc/contract.ts';

/** How long the screen may sit unused before it locks (tests can shorten it). */
export function lockSeconds(db: Db): number {
  const forTests = testKnob('SHOPLEDGER_LOCK_SECONDS');
  if (forTests !== undefined) return Number(forTests) || 0;
  return lockMinutes(db) * 60;
}

/** Minutes of no use before the screen locks; 10 unless the owner changed it, 0 = never. */
export function lockMinutes(db: Db): number {
  const n = Number(getSetting(db, 'lock.minutes') ?? '10');
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 10;
}

/**
 * On 1 April the new financial year starts by itself: bills can be made straight away, and the
 * old year stays open (for late supplier bills and returns) until the owner closes it.
 */
export function ensureCurrentYear(ctx: Pick<HandlerContext, 'db' | 'today'>): void {
  if (!isSetupComplete(ctx.db)) return;
  if (financialYearOn(ctx.db, ctx.today())) return;
  ensureFinancialYearFor(ctx.db, ctx.today());
}

export function sessionState(ctx: Omit<HandlerContext, 'user'>): SessionState {
  ensureCurrentYear(ctx);
  const fy = financialYearOn(ctx.db, ctx.today());
  return {
    setupComplete: isSetupComplete(ctx.db),
    financialYear: fy ? { startDate: fy.startDate, endDate: fy.endDate, label: fy.label } : null,
    user: ctx.session.user,
    today: ctx.today(),
    company: getCompany(ctx.db) ?? null,
    lockAfterSeconds: lockSeconds(ctx.db),
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
  | 'auth.unlock'
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
  'auth.unlock': (req, ctx) => {
    // the locked screen asks the signed-in person for their PIN again; wrong tries count like at sign-in
    const me = ctx.user();
    let again;
    try {
      again = login(ctx.db, me.name, req.pin, { userId: me.id }, 'unlock');
    } catch (e) {
      if (e instanceof ValidationError && e.message.startsWith('The name or PIN'))
        throw new ValidationError('That PIN is not right. Please try again.');
      throw e;
    }
    if (again.id !== me.id) throw new ValidationError('That PIN is not right. Please try again.');
    return null;
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
      heldBills: heldCount(ctx.db, { userId: ctx.user().id, isOwner: ctx.user().role === 'owner' }),
      backupWarning:
        backupProblem(ctx.db) ?? backupReminder(getSetting(ctx.db, 'backup.last_at'), today),
    };
  },
};
