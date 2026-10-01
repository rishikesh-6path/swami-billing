/// <reference types="vite/client" />
import type { ShopledgerApi } from '../ipc/contract.ts';

declare global {
  interface Window {
    shopledger: ShopledgerApi;
  }
}
