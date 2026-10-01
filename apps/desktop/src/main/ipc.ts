import type { IpcMain } from 'electron';
import {
  can,
  MigrationError,
  PostingError,
  ValidationError,
  type Db,
  type Role,
} from '@shopledger/core';
import {
  channels,
  contract,
  type Channel,
  type IpcResult,
  type Req,
  type Res,
  type SessionUser,
} from '../ipc/contract.ts';

export interface Session {
  user: SessionUser | null;
}

export interface HandlerContext {
  db: Db;
  dbPath: string;
  session: Session;
  /** Today's date in India (YYYY-MM-DD). Can be fixed with SHOPLEDGER_TODAY for tests. */
  today: () => string;
  /** The signed-in user; throws if nobody is signed in (handlers on non-public channels). */
  user: () => SessionUser & { role: Role };
}

export type Handlers = {
  [C in Channel]: (request: Req<C>, ctx: HandlerContext) => Res<C> | Promise<Res<C>>;
};

const NOT_SIGNED_IN = 'Please sign in first.';
const NOT_ALLOWED = 'You do not have permission to do this. Please ask the owner.';
const GENERIC =
  'Something went wrong and nothing was saved. Please try again. If it keeps happening, call support.';

/** Errors written for shop staff are shown as they are; anything else becomes a generic message. */
export function friendlyMessage(error: unknown): string {
  if (
    error instanceof ValidationError ||
    error instanceof PostingError ||
    error instanceof MigrationError
  ) {
    return error.message;
  }
  return GENERIC;
}

/**
 * Registers a handler for every channel. For each call, in main (the trust boundary): checks
 * who is allowed, validates the request with zod, runs the handler, and wraps the outcome so the
 * renderer only ever receives data or a plain-language message.
 */
export function registerHandlers(
  ipcMain: IpcMain,
  handlers: Handlers,
  ctx: Omit<HandlerContext, 'user'>,
): void {
  const full: HandlerContext = {
    ...ctx,
    user: () => {
      if (!ctx.session.user) throw new ValidationError(NOT_SIGNED_IN);
      return ctx.session.user;
    },
  };
  for (const channel of channels) {
    const spec = contract[channel];
    const handler = handlers[channel] as (request: unknown, ctx: HandlerContext) => unknown;
    ipcMain.handle(channel, async (_event, raw: unknown): Promise<IpcResult<unknown>> => {
      try {
        if (spec.access !== 'public') {
          const user = ctx.session.user;
          if (!user) return { ok: false, message: NOT_SIGNED_IN };
          if (spec.access !== 'user' && !can(user.role, spec.access)) {
            return { ok: false, message: NOT_ALLOWED };
          }
        }
        const parsed = spec.request.safeParse(raw);
        if (!parsed.success) {
          console.error(`[shopledger] invalid request on ${channel}`, parsed.error.message);
          return {
            ok: false,
            message: 'Some of the details entered are not valid. Please check and try again.',
          };
        }
        return { ok: true, data: await handler(parsed.data, full) };
      } catch (error) {
        if (!(error instanceof ValidationError || error instanceof PostingError)) {
          console.error(`[shopledger] ${channel} failed`, error);
        }
        return { ok: false, message: friendlyMessage(error) };
      }
    });
  }
}
