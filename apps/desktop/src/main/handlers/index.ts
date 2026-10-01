import type { Handlers } from '../ipc.ts';
import { masterHandlers } from './masters.ts';
import { printHandlers } from './print.ts';
import { reportHandlers } from './reports.ts';
import { sessionHandlers } from './session.ts';
import { settingsHandlers } from './settings.ts';
import { voucherHandlers } from './vouchers.ts';

export const handlers: Handlers = {
  ...sessionHandlers,
  ...voucherHandlers,
  ...masterHandlers,
  ...reportHandlers,
  ...printHandlers,
  ...settingsHandlers,
};
