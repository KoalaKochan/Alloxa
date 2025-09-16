import { ParsedTransactionWithMeta } from '@solana/web3.js';
import { DetectedPool } from '../core/types';
import { Token } from '@raydium-io/raydium-sdk';
import { logger } from '../utils/logger';

export interface DecoderConfig {
  programId: string;
  dexName: string;
  minAccounts: number;
  discriminator?: Uint8Array;
}

export abstract class BaseDecoder {
  protected config: DecoderConfig;

  constructor(config: DecoderConfig) {
    this.config = config;
  }

  abstract decodePoolFromTx(tx: ParsedTransactionWithMeta): DetectedPool[];

  protected abstract decodeInstruction(instruction: any, tx: ParsedTransactionWithMeta): DetectedPool | null;

  protected isCreatePoolInstruction(discriminator: Uint8Array): boolean {
    if (!this.config.discriminator) {
      // Если discriminator не задан, считаем все инструкции валидными
      return true;
    }
    
    // Сравниваем с ожидаемым discriminator
    return discriminator.every((byte, index) => byte === this.config.discriminator![index]);
  }

  protected validatePoolData(poolId: string, baseMint: string, quoteMint: string): boolean {
    if (!poolId || !baseMint || !quoteMint) {
      return false;
    }

    // Фильтруем только SOL пары
    if (quoteMint !== Token.WSOL.mint.toString()) {
      return false;
    }

    return true;
  }

  protected createPool(
    poolId: string, 
    baseMint: string, 
    quoteMint: string, 
    lpMint?: string
  ): DetectedPool {
    const pool: DetectedPool = {
      dex: this.config.dexName,
      poolId,
      baseMint,
      quoteMint,
      timestamp: Date.now(),
    };
    
    if (lpMint) {
      pool.lpMint = lpMint;
    }
    
    return pool;
  }

  protected logDecodeError(error: any, context: string): void {
    logger.debug({ error, context }, `Failed to decode ${this.config.dexName} ${context}`);
  }
}
