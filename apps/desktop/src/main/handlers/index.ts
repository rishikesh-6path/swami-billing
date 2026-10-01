import type { Handlers } from '../ipc.ts';
import { sessionHandlers } from './session.ts';

export const handlers: Handlers = {
  ...sessionHandlers,
};
