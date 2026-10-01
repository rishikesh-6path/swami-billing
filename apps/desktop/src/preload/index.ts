import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Channel, type ShopledgerApi } from '../ipc/contract.ts';

const api: ShopledgerApi = {
  invoke(channel: Channel, request: unknown) {
    if (!channels.includes(channel)) {
      return Promise.reject(new Error(`Unknown channel: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, request) as never;
  },
};

contextBridge.exposeInMainWorld('shopledger', api);
