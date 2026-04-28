// Bundle-friendly logger. Pino's pretty-print transport spawns a worker
// thread (via thread-stream) that bun --compile can't bundle cleanly —
// `real-require` ends up missing at runtime. We don't need the structured-
// log story for the sidecar; the Tauri shell captures stdout/stderr lines
// verbatim into the log file. So: a tiny pino-shaped wrapper around console
// that supports `.info(msg)`, `.info({ obj }, msg)`, level filtering, and
// `.level` mutation (used by the --verbose flag).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

type LogFn = (objOrMsg: unknown, maybeMsg?: string) => void;

interface Logger {
  level: LogLevel;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, val) =>
      val instanceof Error ? { message: val.message, stack: val.stack } : val,
    );
  } catch {
    return String(v);
  }
}

function makeLogger(): Logger {
  const initial = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  const state = { level: (initial in LEVEL_RANK ? initial : 'info') as LogLevel };

  const log = (level: LogLevel, objOrMsg: unknown, maybeMsg?: string) => {
    if (LEVEL_RANK[level] < LEVEL_RANK[state.level]) return;
    const time = new Date().toISOString().slice(11, 19);
    const prefix = `[${time}] ${level.toUpperCase().padEnd(5)}`;
    if (typeof objOrMsg === 'string') {
      console.log(`${prefix} ${objOrMsg}`);
    } else if (typeof maybeMsg === 'string') {
      console.log(`${prefix} ${maybeMsg} ${safeStringify(objOrMsg)}`);
    } else {
      console.log(`${prefix} ${safeStringify(objOrMsg)}`);
    }
  };

  return {
    get level() {
      return state.level;
    },
    set level(v: LogLevel) {
      if (v in LEVEL_RANK) state.level = v;
    },
    debug: (o, m) => log('debug', o, m),
    info: (o, m) => log('info', o, m),
    warn: (o, m) => log('warn', o, m),
    error: (o, m) => log('error', o, m),
  };
}

export const logger = makeLogger();
