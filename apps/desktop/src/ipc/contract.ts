import { z } from 'zod';
import type { Action, Company, Role } from '@shopledger/core';

/**
 * The only boundary between the renderer and everything else. Every channel declares who may
 * call it (`access`), a zod request schema (checked in main, the trust boundary) and a response
 * type. Add new channels here; handlers live in src/main/handlers.
 */

export const id = z.number().int().positive();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Who may call a channel: anyone, any signed-in user, or users allowed to perform an action. */
export type Access = 'public' | 'user' | Action;

function channel<Q extends z.ZodType, R>(access: Access, request: Q) {
  return { access, request, response: null as unknown as R };
}

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
}

export interface SessionState {
  setupComplete: boolean;
  user: SessionUser | null;
  today: string;
  company: Company | null;
}

export interface HomeSummary {
  todaySalesPaise: number;
  todayBills: number;
  cashInHandPaise: number;
  toCollectPaise: number;
  lowStockItems: number;
}

const none = z.object({}).strict();

export const contract = {
  'app.info': channel<typeof none, { dbPath: string; schemaVersion: number }>('public', none),
  'session.state': channel<typeof none, SessionState>('public', none),
  'setup.complete': channel<
    z.ZodObject<{
      shopName: z.ZodString;
      address: z.ZodString;
      stateCode: z.ZodString;
      gstin: z.ZodString;
      phone: z.ZodString;
      ownerName: z.ZodString;
      ownerPin: z.ZodString;
    }>,
    SessionState
  >(
    'public',
    z.object({
      shopName: z.string(),
      address: z.string(),
      stateCode: z.string(),
      gstin: z.string(),
      phone: z.string(),
      ownerName: z.string(),
      ownerPin: z.string(),
    }),
  ),
  'auth.users': channel<typeof none, { id: number; name: string }[]>('public', none),
  'auth.login': channel<z.ZodObject<{ name: z.ZodString; pin: z.ZodString }>, SessionState>(
    'public',
    z.object({ name: z.string(), pin: z.string() }),
  ),
  'auth.logout': channel<typeof none, SessionState>('public', none),
  'lookup.states': channel<typeof none, { code: string; name: string }[]>('public', none),
  'home.summary': channel<typeof none, HomeSummary>('user', none),
} as const;

export type Channel = keyof typeof contract;
export type Req<C extends Channel> = z.infer<(typeof contract)[C]['request']>;
export type Res<C extends Channel> = (typeof contract)[C]['response'];

/** What main sends back: either the data, or a message already written for shop staff. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ShopledgerApi {
  invoke<C extends Channel>(channel: C, request: Req<C>): Promise<Res<C>>;
}

export const channels = Object.keys(contract) as Channel[];
