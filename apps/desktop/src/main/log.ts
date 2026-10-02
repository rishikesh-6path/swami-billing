import { join } from 'node:path';
import { app } from 'electron';
import { appendLog, formatLogLine } from '@shopledger/core';

/** Where the log is kept: inside the program's data folder, next to the shop data. */
export const logDir = (): string => join(app.getPath('userData'), 'logs');

/**
 * Writes a line to the log file (and the console, for developers). Pass the error itself, not
 * what the user typed: only the error's name and message are written, never bill or party data.
 */
export function log(level: 'info' | 'warn' | 'error', message: string, error?: unknown): void {
  const line = formatLogLine(level, message, error);
  if (level === 'error') console.error(line);
  else console.log(line);
  appendLog(logDir(), line);
}
