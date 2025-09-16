import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { config } from '../utils/config';
import { Token, TokenAmount } from '@raydium-io/raydium-sdk';

export async function checkPoolSize(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking pool size');
    
    // Пока используем poolId, так как quoteVault нет в DetectedPool
    const quoteVault = new PublicKey(pool.poolId);
    const response = await connection.getTokenAccountBalance(quoteVault, connection.commitment);
    
    if (!response.value) {
      logger.debug({ pool }, 'Quote vault balance not found');
      return {
        ok: false,
        message: 'Quote vault balance not found',
        code: LOG_CODES.SKIP_POOL_SIZE,
      };
    }

    const quoteToken = Token.WSOL;
    const poolSize = new TokenAmount(quoteToken, response.value.amount, true); // isRaw = true
    
    // Создаем min/max TokenAmount для сравнения
    const minPoolSize = new TokenAmount(quoteToken, config.minPoolSize, false); // isRaw = false (SOL)
    const maxPoolSize = new TokenAmount(quoteToken, config.maxPoolSize, false); // isRaw = false (SOL)
    
    logger.debug({ 
      pool, 
      poolSize: poolSize.toFixed(),
      minPoolSize: minPoolSize.toFixed(),
      maxPoolSize: maxPoolSize.toFixed()
    }, 'Pool size comparison');
    
    // Проверяем максимальный размер
    if (!maxPoolSize.isZero() && poolSize.raw.gt(maxPoolSize.raw)) {
      logger.debug({ pool, poolSize: poolSize.toFixed(), maxPoolSize: maxPoolSize.toFixed() }, 'Pool size too large');
      return {
        ok: false,
        message: `Pool size ${poolSize.toFixed()} > ${maxPoolSize.toFixed()}`,
        code: LOG_CODES.SKIP_POOL_SIZE,
      };
    }
    
    // Проверяем минимальный размер
    if (!minPoolSize.isZero() && poolSize.raw.lt(minPoolSize.raw)) {
      logger.debug({ pool, poolSize: poolSize.toFixed(), minPoolSize: minPoolSize.toFixed() }, 'Pool size too small');
      return {
        ok: false,
        message: `Pool size ${poolSize.toFixed()} < ${minPoolSize.toFixed()}`,
        code: LOG_CODES.SKIP_POOL_SIZE,
      };
    }
    
    logger.debug({ pool, poolSize: poolSize.toFixed() }, 'Pool size check passed');
    
    return {
      ok: true,
      message: `Pool size ${poolSize.toFixed()} is acceptable`,
    };
  } catch (error) {
    logger.error({ error, pool }, 'Pool size filter failed');
    return {
      ok: false,
      message: 'Pool size check failed',
      code: LOG_CODES.SKIP_POOL_SIZE,
    };
  }
}

