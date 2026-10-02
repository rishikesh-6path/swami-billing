// electron-vite turns `import X from './file?nodeWorker'` into a function that starts that file
// as a background thread (see electron-vite/node.d.ts, declared here so it always applies).
declare module '*?nodeWorker' {
  import type { Worker, WorkerOptions } from 'node:worker_threads';
  export default function startWorker(options: WorkerOptions): Worker;
}
