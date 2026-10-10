// Runs Playwright. On a headless Linux box (CI, cloud container) it provides a virtual display.
import { spawnSync } from 'node:child_process';

const headlessLinux = process.platform === 'linux' && !process.env['DISPLAY'];
const playwright = ['pnpm', 'exec', 'playwright', 'test', ...process.argv.slice(2)];
const [cmd, args] = headlessLinux
  ? ['xvfb-run', ['-a', ...playwright]]
  : [playwright[0], playwright.slice(1)];

// On Windows pnpm is a .cmd file, which Node starts only through the shell; the command is then
// one line, so arguments with spaces (e.g. -g "Find a bill") are quoted
const result =
  process.platform === 'win32'
    ? spawnSync(
        [cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' '),
        {
          stdio: 'inherit',
          shell: true,
        },
      )
    : spawnSync(cmd, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
