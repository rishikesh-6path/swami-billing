import type { Handlers } from '../ipc.ts';
import { masterHandlers } from './masters.ts';
import { reportHandlers } from './reports.ts';
import { sessionHandlers } from './session.ts';
import { voucherHandlers } from './vouchers.ts';

export const handlers: Handlers = {
  ...sessionHandlers,
  ...voucherHandlers,
  ...masterHandlers,
  ...reportHandlers,
};
