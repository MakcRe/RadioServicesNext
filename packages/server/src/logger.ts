import pino from 'pino';
import { mkdirSync, existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import type { LoggingConfig } from '@radio-services/shared';

export function createLogger(config: LoggingConfig, date: Date = new Date()): pino.Logger {
  const dateStr = date.toISOString().slice(0, 10);
  const logDir = config.directory;
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const logFile = join(logDir, `${dateStr}.log`);

  return pino(
    { level: config.level },
    pino.multistream([
      { stream: createWriteStream(logFile, { flags: 'a' }), level: config.level },
      { stream: process.stdout, level: config.level },
    ])
  );
}
