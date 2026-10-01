import { z } from 'zod';

/**
 * The only boundary between the renderer and everything else. Every channel declares a zod
 * request and response schema; main validates both, preload exposes only these channels,
 * and the renderer imports the inferred types. Add new channels here.
 */
export const contract = {
  'app.info': {
    request: z.object({}).strict(),
    response: z.object({
      dbPath: z.string(),
      schemaVersion: z.number().int().nonnegative(),
    }),
  },
} as const;

export type Channel = keyof typeof contract;
export type Req<C extends Channel> = z.infer<(typeof contract)[C]['request']>;
export type Res<C extends Channel> = z.infer<(typeof contract)[C]['response']>;

export interface ShopledgerApi {
  invoke<C extends Channel>(channel: C, request: Req<C>): Promise<Res<C>>;
}

export const channels = Object.keys(contract) as Channel[];
