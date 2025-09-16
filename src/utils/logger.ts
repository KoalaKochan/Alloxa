import pino from 'pino';

// Коды логирования согласно ТЗ
export const LOG_CODES = {
  // Обнаружение пулов
  DETECTED_POOL: 'DETECTED_POOL',
  LISTENER_READY: 'LISTENER_READY',
  
  // Пропуски
  SKIP_ROUTE_NOT_FOUND: 'SKIP_ROUTE_NOT_FOUND',
  SKIP_IMPACT_GT_LIMIT: 'SKIP_IMPACT_GT_LIMIT',
  SKIP_NO_LOCK_15M: 'SKIP_NO_LOCK_15M',
  SKIP_BURN_TOO_LOW: 'SKIP_BURN_TOO_LOW',
  SKIP_MUTABLE: 'SKIP_MUTABLE',
  SKIP_RENOUNCED: 'SKIP_RENOUNCED',
  SKIP_NO_SOCIALS: 'SKIP_NO_SOCIALS',
  SKIP_NO_IMAGE: 'SKIP_NO_IMAGE',
  SKIP_POOL_SIZE: 'SKIP_POOL_SIZE',
  SKIP_POOL_AGE: 'SKIP_POOL_AGE',
  SKIP_HOLDER_CONCENTRATION: 'SKIP_HOLDER_CONCENTRATION',
  SKIP_TOKEN2022_EXTENSION: 'SKIP_TOKEN2022_EXTENSION',
  
  // Покупка
  BUY_SUCCESS: 'BUY_SUCCESS',
  BUY_FAILED: 'BUY_FAILED',
  JUP_TX_SEND_FAIL: 'JUP_TX_SEND_FAIL',
  
  // Продажа
  SELL_SUCCESS: 'SELL_SUCCESS',
  SELL_FAILED: 'SELL_FAILED',
  SELL_STOP_LOSS: 'SELL_STOP_LOSS',
  SELL_TAKE_PROFIT: 'SELL_TAKE_PROFIT',
  SELL_TIMEOUT: 'SELL_TIMEOUT',
  
  // LP защита
  LP_LOCK_OK: 'LP_LOCK_OK',
  LP_BURN_OK: 'LP_BURN_OK',
  LP_CHECK_FAILED: 'LP_CHECK_FAILED',
  
  // Ожидание
  WAITING_CONSECUTIVE_MATCHES: 'WAITING_CONSECUTIVE_MATCHES',
  
  // Мониторинг слушателей
  LISTENER_STARTED: 'LISTENER_STARTED',
  LISTENER_STOPPED: 'LISTENER_STOPPED',
  
  // Обработка пулов
  POOL_PROCESSING_START: 'POOL_PROCESSING_START',
  POOL_PROCESSING_END: 'POOL_PROCESSING_END',
  POOL_ACCEPTED: 'POOL_ACCEPTED',
  POOL_REJECTED: 'POOL_REJECTED',
  POOL_DUPLICATE: 'POOL_DUPLICATE',
  
  // Фильтры
  FILTER_START: 'FILTER_START',
  FILTER_PASS: 'FILTER_PASS',
  FILTER_FAIL: 'FILTER_FAIL',
} as const;

export type LogCode = typeof LOG_CODES[keyof typeof LOG_CODES];

const createLogger = (level: string = 'info') => {
  
    // В разработке: логи в консоль + файл
    return pino({
      level,
      redact: ['privateKey', 'signature'],
      serializers: {
        error: pino.stdSerializers.err,
      },
      transport: {
        targets: [
          {
            target: 'pino-pretty',
            level: 'debug',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
          {
            target: 'pino/file',
            level: 'debug',
            options: {
              destination: './logs/bot.log',
              mkdir: true,
            },
          },
          {
            target: 'pino/file',
            level: 'debug',
            options: {
              destination: 1, // stdout
              mkdir: false,
            },
          },
        ],
      },
    });
  
  
};

export const logger = createLogger(process.env['LOG_LEVEL'] || 'debug');

// Создаем отдельный логгер для Docker (JSON в одну строку)
const createDockerLogger = (level: string = 'info') => {
  return pino({
    level,
    redact: ['privateKey', 'signature'],
    serializers: {
      error: pino.stdSerializers.err,
    },
  });
};

export const dockerLogger = createDockerLogger(process.env['LOG_LEVEL'] || 'debug');

export const logPoolDetected = (dex: string, baseMint: string, quoteMint: string, poolId: string) => {
  dockerLogger.info({
    code: LOG_CODES.DETECTED_POOL,
    dex,
    base: baseMint,
    quote: quoteMint,
    pool: poolId,
  }, 'DETECTED_POOL');
};

export const logSkip = (code: LogCode, reason: string, mint?: string) => {
  dockerLogger.debug({
    code,
    reason,
    mint,
  }, code);
};

export const logBuy = (code: LogCode, mint: string, signature?: string, error?: string) => {
  const level = code === LOG_CODES.BUY_SUCCESS ? 'info' : 'error';
  dockerLogger[level]({
    code,
    mint,
    signature,
    error,
  }, code);
};

export const logSell = (code: LogCode, mint: string, signature?: string, error?: string) => {
  const level = code === LOG_CODES.SELL_SUCCESS ? 'info' : 'error';
  dockerLogger[level]({
    code,
    mint,
    signature,
    error,
  }, code);
};

export const logLpProtection = (code: LogCode, mint: string, details?: any) => {
  dockerLogger.info({
    code,
    mint,
    ...details,
  }, code);
};

export const logListenerReady = (dex: string, mode: string) => {
  dockerLogger.info({
    code: LOG_CODES.LISTENER_READY,
    dex,
    mode,
  }, 'LISTENER_READY');
};

export const logListenerStarted = (dex: string) => {
  dockerLogger.info({
    code: LOG_CODES.LISTENER_STARTED,
    dex,
  }, 'LISTENER_STARTED');
};

export const logListenerStopped = (dex: string) => {
  dockerLogger.info({
    code: LOG_CODES.LISTENER_STOPPED,
    dex,
  }, 'LISTENER_STOPPED');
};

export const logPoolProcessingStart = (poolId: string, dex: string) => {
  dockerLogger.info({
    code: LOG_CODES.POOL_PROCESSING_START,
    poolId,
    dex,
  }, 'POOL_PROCESSING_START');
};

export const logPoolProcessingEnd = (poolId: string, dex: string, duration: number) => {
  dockerLogger.info({
    code: LOG_CODES.POOL_PROCESSING_END,
    poolId,
    dex,
    duration,
  }, 'POOL_PROCESSING_END');
};

export const logPoolAccepted = (poolId: string, dex: string, reason: string, tokenName?: string, tokenSymbol?: string) => {
  dockerLogger.info({
    code: LOG_CODES.POOL_ACCEPTED,
    poolId,
    dex,
    reason,
    tokenName: tokenName || 'Unknown',
    tokenSymbol: tokenSymbol || 'Unknown',
  }, 'POOL_ACCEPTED');
};

export const logPoolRejected = (poolId: string, dex: string, reason: string, failedFilters: string[], tokenName?: string, tokenSymbol?: string) => {
  dockerLogger.info({
    code: LOG_CODES.POOL_REJECTED,
    poolId,
    dex,
    reason,
    failedFilters,
    tokenName: tokenName || 'Unknown',
    tokenSymbol: tokenSymbol || 'Unknown',
  }, 'POOL_REJECTED');
};

export const logFilterStart = (filterName: string, poolId: string) => {
  dockerLogger.info({
    code: LOG_CODES.FILTER_START,
    filterName,
    poolId,
  }, 'FILTER_START');
};

export const logFilterPass = (filterName: string, poolId: string, duration: number) => {
  dockerLogger.info({
    code: LOG_CODES.FILTER_PASS,
    filterName,
    poolId,
    duration,
  }, 'FILTER_PASS');
};

export const logFilterFail = (filterName: string, poolId: string, reason: string, duration: number) => {
  dockerLogger.info({
    code: LOG_CODES.FILTER_FAIL,
    filterName,
    poolId,
    reason,
    duration,
  }, 'FILTER_FAIL');
};

