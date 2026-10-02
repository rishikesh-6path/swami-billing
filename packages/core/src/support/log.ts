import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

export interface LogOptions {
  /** A file is started afresh once it passes this size. */
  maxBytes?: number;
  /** How many old files are kept besides the current one. */
  keep?: number;
}

const NAME = 'shopledger.log';

/**
 * Adds one line to the log. Old logs are renamed `shopledger.log.1` (newest) to `.N` and the
 * oldest is deleted, so the log can never fill the disk. Writing a log must never break the app,
 * so any problem here is swallowed.
 */
export function appendLog(dir: string, line: string, options: LogOptions = {}): void {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const keep = options.keep ?? 5;
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, NAME);
    if (existsSync(file) && statSync(file).size >= maxBytes) {
      rmSync(join(dir, `${NAME}.${keep}`), { force: true });
      for (let i = keep - 1; i >= 1; i--) {
        const from = join(dir, `${NAME}.${i}`);
        if (existsSync(from)) renameSync(from, join(dir, `${NAME}.${i + 1}`));
      }
      renameSync(file, join(dir, `${NAME}.1`));
    }
    appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    // logging is best effort
  }
}

/**
 * One log line: time, level, message and, for errors, the error's name and message (never its
 * data). Folder paths are replaced, because they hold the Windows user's name.
 */
export function formatLogLine(
  level: 'info' | 'warn' | 'error',
  message: string,
  error?: unknown,
): string {
  const when = new Date().toISOString();
  const detail =
    error === undefined
      ? ''
      : ` | ${
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : typeof error === 'string'
              ? error
              : 'unknown error'
        }`;
  return `${when} ${level.toUpperCase()} ${message}${detail}`
    .replace(/[A-Za-z]:[\\/][^'"\r\n]*/g, '<folder>')
    .replace(/\/(?:home|Users|root|tmp|var|mnt|media)\/[^'"\r\n]*/g, '<folder>')
    .replace(/[\r\n]+/g, ' ');
}

/** The last `count` lines of the current log, oldest first (empty when there is no log yet). */
export function readLogTail(dir: string, count = 200): string[] {
  try {
    const text = readFileSync(join(dir, NAME), 'utf8');
    return text
      .split('\n')
      .filter((l) => l !== '')
      .slice(-count);
  } catch {
    return [];
  }
}
