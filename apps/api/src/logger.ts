const REDACT_KEYS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-forwarded-for',
  'password',
  'token',
  'secret',
  'jwt',
  'session',
  'credential',
  'apiKey',
  'accessToken',
  'refreshToken',
  'privateKey',
  'publicKey',
  'encryptionKey',
  'signingKey',
];

const REDACT_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /password["\s:=]+[^\s,"}]+/gi,
  /token["\s:=]+[^\s,"}]+/gi,
  /secret["\s:=]+[^\s,"}]+/gi,
  /key["\s:=]+[^\s,"}]+/gi,
];

function redactValue(key: string, value: unknown): unknown {
  const keyLower = key.toLowerCase();
  if (REDACT_KEYS.some((k) => keyLower.includes(k))) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    let redacted = value;
    for (const pattern of REDACT_PATTERNS) {
      redacted = redacted.replace(pattern, (match) => {
        const colonIndex = match.indexOf(':');
        const eqIndex = match.indexOf('=');
        const spaceIndex = match.indexOf(' ');
        const separatorIndex = [colonIndex, eqIndex, spaceIndex].filter((i) => i >= 0).sort((a, b) => a - b)[0];
        if (separatorIndex >= 0) {
          return match.slice(0, separatorIndex + 1) + '[REDACTED]';
        }
        return '[REDACTED]';
      });
    }
    return redacted;
  }
  if (typeof value === 'object' && value !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      redacted[k] = redactValue(k, v);
    }
    return redacted;
  }
  return value;
}

function formatLog(level: string, message: string, meta: Record<string, unknown> = {}): string {
  const timestamp = new Date().toISOString();
  const redactedMeta = Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, redactValue(k, v)])
  );
  const logEntry = {
    timestamp,
    level,
    message,
    ...redactedMeta,
  };
  return JSON.stringify(logEntry);
}

class Logger {
  private level: 'debug' | 'info' | 'warn' | 'error';

  constructor() {
    this.level = 'info';
  }

  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.level = level;
  }

  private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('debug')) {
      console.log(formatLog('debug', message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('info')) {
      console.log(formatLog('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('warn')) {
      console.warn(formatLog('warn', message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog('error')) {
      console.error(formatLog('error', message, meta));
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    const childLogger = new Logger();
    childLogger.level = this.level;
    const originalMethods = {
      debug: childLogger.debug.bind(childLogger),
      info: childLogger.info.bind(childLogger),
      warn: childLogger.warn.bind(childLogger),
      error: childLogger.error.bind(childLogger),
    };
    childLogger.debug = (msg, meta) => originalMethods.debug(msg, { ...bindings, ...meta });
    childLogger.info = (msg, meta) => originalMethods.info(msg, { ...bindings, ...meta });
    childLogger.warn = (msg, meta) => originalMethods.warn(msg, { ...bindings, ...meta });
    childLogger.error = (msg, meta) => originalMethods.error(msg, { ...bindings, ...meta });
    return childLogger;
  }
}

let loggerInstance: Logger | null = null;

export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

export function initLogger(validatedEnv: { LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error'; REDACT_SENSITIVE_LOGS: boolean }): Logger {
  const logger = getLogger();
  logger.setLevel(validatedEnv.LOG_LEVEL);
  return logger;
}

export const logger = getLogger();