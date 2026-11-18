export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** json: one object per line (for files and CI); pretty: for humans. */
  format?: 'json' | 'pretty';
  write?: (line: string) => void;
  now?: () => Date;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/** Structured logger. Defaults to JSON lines on stderr. */
export function createLogger(opts: LoggerOptions = {}, bound: Fields = {}): Logger {
  const level = opts.level ?? 'info';
  const format = opts.format ?? 'json';
  const write = opts.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = opts.now ?? (() => new Date());

  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields: Fields = {}) => {
    if (RANK[lvl] < RANK[level]) return;
    const all = { ...bound, ...fields };
    if (format === 'json') {
      write(JSON.stringify({ ts: now().toISOString(), level: lvl, msg, ...all }, errorReplacer));
      return;
    }
    const extra = Object.entries(all)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v, errorReplacer)}`)
      .join(' ');
    write(`${now().toISOString().slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${msg}${extra ? `  ${extra}` : ''}`);
  };

  return {
    debug: (m, f) => {
      emit('debug', m, f);
    },
    info: (m, f) => {
      emit('info', m, f);
    },
    warn: (m, f) => {
      emit('warn', m, f);
    },
    error: (m, f) => {
      emit('error', m, f);
    },
    child: (fields) => createLogger(opts, { ...bound, ...fields }),
  };
}

/** A logger that drops everything; the library default. */
export const silentLogger: Logger = createLogger({ level: 'silent' });

function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}
