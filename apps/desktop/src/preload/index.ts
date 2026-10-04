import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Channel, type IpcResult, type ShopledgerApi } from '../ipc/contract.ts';

const api: ShopledgerApi = {
  async invoke(channel: Channel, request: unknown) {
    if (!channels.includes(channel)) throw new Error(`Unknown channel: ${String(channel)}`);
    const result = (await ipcRenderer.invoke(channel, request)) as IpcResult<never>;
    if (!result.ok) throw new Error(result.message);
    return result.data;
  },
  async invokeResult(channel: Channel, request: unknown) {
    if (!channels.includes(channel)) throw new Error(`Unknown channel: ${String(channel)}`);
    return (await ipcRenderer.invoke(channel, request)) as IpcResult<never>;
  },
};

contextBridge.exposeInMainWorld('shopledger', api);
