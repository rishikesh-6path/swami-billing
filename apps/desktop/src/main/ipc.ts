import type { IpcMain } from 'electron';
import { log } from './log.ts';
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
  /** Saves one text file (CSV) where the user chooses; returns the path, or null if they cancelled. */
  saveText: (defaultName: string, content: string) => Promise<string | null>;
  /** Saves several files into a folder the user chooses; returns the folder, or null if cancelled. */
  saveFiles: (files: Record<string, string>, subfolder: string) => Promise<string | null>;
  /** Prints a page of HTML. With no printer name the system print dialog is shown. */
  printHtml: (
    html: string,
    opts: { size: 'a4' | 'thermal'; printerName?: string | undefined },
  ) => Promise<boolean>;
  /** The program's version, for the support information. */
  appVersion: string;
  /** The printers Windows knows about, by name. */
  listPrinters: () => Promise<string[]>;
  /** Renders HTML to a PDF and lets the user save it; returns the path, or null if cancelled. */
  savePdf: (
    html: string,
    opts: { size: 'a4' | 'thermal'; defaultName: string },
  ) => Promise<string | null>;
  /** Saves the page on the screen (a report) as a PDF; returns the path, or null if cancelled. */
  savePagePdf: (defaultName: string) => Promise<string | null>;
  /** Where backups go when the owner has not chosen a folder. */
  backupPlace: { defaultFolder: string };
  /** The shop's current date and time (YYYY-MM-DD, HH:MM:SS). */
  clock: () => { date: string; time: string };
  /** Lets the user pick a folder; null if they cancelled. */
  chooseFolder: (title: string) => Promise<string | null>;
  /** Lets the user pick a spreadsheet (CSV); null if they cancelled. */
  chooseCsv: () => Promise<{ name: string; text: string } | null>;
  /** Lets the user pick a backup file; null if they cancelled. */
  chooseBackupFile: () => Promise<string | null>;
  /** Swaps the shop data for a backup and restarts the app. The caller must have checked the file. */
  restoreFrom: (path: string) => Promise<void>;
  /** The signed-in user; throws if nobody is signed in (handlers on non-public channels). */
  user: () => SessionUser & { role: Role };
}

export type Handlers = {
  [C in Channel]: (request: Req<C>, ctx: HandlerContext) => Res<C> | Promise<Res<C>>;
};

const NOT_SIGNED_IN = 'Please sign in first.';
const NOT_ALLOWED = 'You do not have permission to do this. Please ask the owner.';
const GENERIC =
  'Something went wrong. Please check what you were doing and try again. If it keeps happening, call support.';
/** Channels that save a bill or a master in one all-or-nothing step, so "nothing was saved" is true. */
const ALL_OR_NOTHING = new Set<string>([
  'voucher.post',
  'voucher.modify',
  'voucher.cancel',
  'item.save',
  'party.save',
]);
const GENERIC_SAVE =
  'Something went wrong and nothing was saved. Please try again. If it keeps happening, call support.';

/** Errors written for shop staff are shown as they are; anything else becomes a generic message. */
export function friendlyMessage(error: unknown, channel = ''): string {
  if (
    error instanceof ValidationError ||
    error instanceof PostingError ||
    error instanceof MigrationError
  ) {
    return error.message;
  }
  return ALL_OR_NOTHING.has(channel) ? GENERIC_SAVE : GENERIC;
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
          log('warn', `a screen sent an invalid request to ${channel}`);
          return {
            ok: false,
            message: 'Some of the details entered are not valid. Please check and try again.',
          };
        }
        return { ok: true, data: await handler(parsed.data, full) };
      } catch (error) {
        if (!(error instanceof ValidationError || error instanceof PostingError)) {
          log('error', `${channel} failed`, error);
        }
        return {
          ok: false,
          message: friendlyMessage(error, channel),
          ...(error instanceof ValidationError && error.code ? { code: error.code } : {}),
        };
      }
    });
  }
}
