import dotenv from 'dotenv';
import { BotConfig } from '../core/types';
import { logger } from './logger';

dotenv.config();

const getEnvVar = (name: string, defaultValue?: string): string => {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    logger.error(`${name} is not set`);
    process.exit(1);
  }
  return value || defaultValue!;
};

const getEnvNumber = (name: string, defaultValue?: number): number => {
  const value = getEnvVar(name, defaultValue?.toString());
  const parsed = Number(value);
  if (isNaN(parsed)) {
    logger.error(`${name} must be a number, got: ${value}`);
    process.exit(1);
  }
  return parsed;
};

const getEnvBoolean = (name: string, defaultValue?: boolean): boolean => {
  const value = getEnvVar(name, defaultValue?.toString());
  return value.toLowerCase() === 'true';
};

export const config: BotConfig = {
  // Основные настройки
  privateKey: getEnvVar('PRIVATE_KEY'),
  rpcEndpoint: getEnvVar('RPC_ENDPOINT'),
  rpcWebsocketEndpoint: getEnvVar('RPC_WEBSOCKET_ENDPOINT'),
  
  // Очередь
  maxTokensAtTheTime: getEnvNumber('MAX_TOKENS_AT_THE_TIME', 3),
  backfillSlots: getEnvNumber('BACKFILL_SLOTS', 50), // Количество слотов для backfill
  
  // Transaction Executor
  transactionExecutor: getEnvVar('TRANSACTION_EXECUTOR', 'default'),
  customFee: getEnvVar('CUSTOM_FEE', '0.001'),
  
  // Фильтры
  filterCheckDuration: getEnvNumber('FILTER_CHECK_DURATION', 50000),
  filterCheckInterval: getEnvNumber('FILTER_CHECK_INTERVAL', 3000),
  consecutiveFilterMatches: getEnvNumber('CONSECUTIVE_FILTER_MATCHES', 2),
  
  // Размер пула
  minPoolSize: getEnvNumber('MIN_POOL_SIZE', 80),
  maxPoolSize: getEnvNumber('MAX_POOL_SIZE', 500),
  
  // Сумма покупки (в SOL)
  buyAmount: getEnvNumber('BUY_AMOUNT', 0.1),
  
  // Возраст пула (увеличиваем до 24 часов)
  poolMaxAgeMs: getEnvNumber('POOL_MAX_AGE_MS', 86400000),
  
  // Холдеры
  holdersTop1MaxRatio: getEnvNumber('HOLDERS_TOP1_MAX_RATIO', 0.2), // 20%
  holdersTop5MaxRatio: getEnvNumber('HOLDERS_TOP5_MAX_RATIO', 0.35), // 35%
  
  // Социальные сети
  minSocialLinks: getEnvNumber('MIN_SOCIAL_LINKS', 1),
  
  // LP защита (отключаем для увеличения проходимости)
  requireLpProtection: getEnvBoolean('REQUIRE_LP_PROTECTION', false),
  
  // Jupiter
  buySlippageBps: getEnvNumber('BUY_SLIPPAGE_BPS', 300),
  maxPriceImpactBps: getEnvNumber('MAX_PRICE_IMPACT_BPS', 500), // 5% по умолчанию
  
  // Автопродажа
  autoSell: getEnvBoolean('AUTO_SELL', true),
  maxSellRetries: getEnvNumber('MAX_SELL_RETRIES', 5),
  autoSellDelay: getEnvNumber('AUTO_SELL_DELAY', 0),
  priceCheckInterval: getEnvNumber('PRICE_CHECK_INTERVAL', 2000),
  priceCheckDuration: getEnvNumber('PRICE_CHECK_DURATION', 200000),
  
  // Raydium Trading
  sellSlippageBps: getEnvNumber('SELL_SLIPPAGE_BPS', 300),
  takeProfit: getEnvNumber('TAKE_PROFIT', 50), // 50% profit
  stopLoss: getEnvNumber('STOP_LOSS', 30), // 30% loss
  trailingStopLoss: getEnvBoolean('TRAILING_STOP_LOSS', false),
  skipSellingIfLostMoreThan: getEnvNumber('SKIP_SELLING_IF_LOST_MORE_THAN', 0), // 0 = disabled
  unitLimit: getEnvNumber('UNIT_LIMIT', 200000),
  unitPrice: getEnvNumber('UNIT_PRICE', 1000000),
  maxBuyRetries: getEnvNumber('MAX_BUY_RETRIES', 3),
  autoBuyDelay: getEnvNumber('AUTO_BUY_DELAY', 0),
  
};

