import type { IpcMain } from 'electron';
import { channels, contract, type Channel, type Req, type Res } from '../ipc/contract.ts';

export type Handlers = {
  [C in Channel]: (request: Req<C>) => Res<C> | Promise<Res<C>>;
};

/**
 * Registers a handler for every channel in the contract. Requests and responses are
 * validated here, in main, because this is the trust boundary.
 */
export function registerHandlers(ipcMain: IpcMain, handlers: Handlers): void {
  for (const channel of channels) {
    const schema = contract[channel];
    const handler = handlers[channel] as (request: unknown) => unknown;
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      const request = schema.request.parse(raw);
      const response = await handler(request);
      return schema.response.parse(response);
    });
  }
}
