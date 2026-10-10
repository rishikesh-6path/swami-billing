// Runs Playwright. On a headless Linux box (CI, cloud container) it provides a virtual display.
import { spawnSync } from 'node:child_process';

const headlessLinux = process.platform === 'linux' && !process.env['DISPLAY'];
const playwright = ['pnpm', 'exec', 'playwright', 'test', ...process.argv.slice(2)];
const [cmd, args] = headlessLinux
  ? ['xvfb-run', ['-a', ...playwright]]
  : [playwright[0], playwright.slice(1)];

// on Windows pnpm is a .cmd file, which Node starts only through the shell
const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
