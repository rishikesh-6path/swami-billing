import type { Handlers } from '../ipc.ts';
import { sessionHandlers } from './session.ts';
import { voucherHandlers } from './vouchers.ts';

export const handlers: Handlers = {
  ...sessionHandlers,
  ...voucherHandlers,
};
