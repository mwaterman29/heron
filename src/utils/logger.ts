import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

// pino-pretty's worker-thread transport buffers heavily when stdout is piped,
// which can look like the process has hung. Use a sync destination + inline
// pretty formatting so output is flushed line-by-line regardless of TTY.
const prettyTarget = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: process.stdout.isTTY ?? false,
    translateTime: 'HH:MM:ss',
    ignore: 'pid,hostname',
    sync: true,
  },
});

export const logger = pino({ level }, prettyTarget);
