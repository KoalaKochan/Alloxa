// import { PublicKey } from '@solana/web3.js';

// Константы DEX программ
export const DEX_PROGRAM_IDS = {
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  METEORA: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  PUMPSWAP: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
} as const;

// Основные типы
export interface DetectedPool {
  dex: string;
  poolId: string;
  baseMint: string;
  quoteMint: string;
  lpMint?: string;
  timestamp: number;
}

export interface FilterResult {
  ok: boolean;
  message?: string;
  code?: string; // DETECTED_POOL, SKIP_*, BUY_*, SELL_*
}

export interface BotConfig {
  // Основные настройки
  privateKey: string;
  rpcEndpoint: string;
  rpcWebsocketEndpoint: string;
  
  // Очередь
  maxTokensAtTheTime: number;
  backfillSlots: number;
  
  // Фильтры
  filterCheckDuration: number;
  filterCheckInterval: number;
  consecutiveFilterMatches: number;
  
  // Размер пула
  minPoolSize: number;
  maxPoolSize: number;
  
  // Сумма покупки (в SOL)
  buyAmount: number;
  
  // Возраст пула
  poolMaxAgeMs: number;
  
  // Холдеры
  holdersTop1MaxRatio: number;
  holdersTop5MaxRatio: number;
  
  // Социальные сети
  minSocialLinks: number;
  
  // LP защита
  requireLpProtection: boolean;
  
  // Jupiter
  buySlippageBps: number;
  maxPriceImpactBps: number;
  
  // Автопродажа
  autoSell: boolean;
  maxSellRetries: number;
  autoSellDelay: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  
  // Raydium Trading
  sellSlippageBps: number;
  takeProfit: number;
  stopLoss: number;
  trailingStopLoss: boolean;
  skipSellingIfLostMoreThan: number;
  unitLimit: number;
  unitPrice: number;
  maxBuyRetries: number;
  autoBuyDelay: number;
  
  // Transaction Executors
  transactionExecutor: string;
  customFee: string;
}

export interface JupiterQuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  maxAccounts?: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      notEnoughLiquidity: boolean;
      minInAmount: string;
      minOutAmount: string;
      priceImpactPct: string;
    };
    percent: number;
  }>;
}

export interface TradingPosition {
  pool: DetectedPool;
  buyTxId: string;
  buyPrice: number;
  amount: number;
  timestamp: number;
  sellTxId?: string;
  sellPrice?: number;
  sellTimestamp?: number;
  status?: 'buying' | 'monitoring' | 'selling' | 'sold';
}

// Константы
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

