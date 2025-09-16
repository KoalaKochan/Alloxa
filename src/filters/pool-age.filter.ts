import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { config } from '../utils/config';

export async function checkPoolAge(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking pool age');
    
    const blockTime = await getBlockTime(connection, new PublicKey(pool.baseMint));
    
    const poolAge = Date.now() - (blockTime * 1000);
    
    logger.debug({ 
      pool, 
      blockTime,
      poolAge: Math.round(poolAge / 1000), 
      maxAge: Math.round(config.poolMaxAgeMs / 1000) 
    }, 'Pool age calculation');
    
    if (poolAge > config.poolMaxAgeMs) {
      logger.debug({ 
        pool, 
        poolAge: Math.round(poolAge / 1000), 
        maxAge: Math.round(config.poolMaxAgeMs / 1000) 
      }, 'Pool too old');
      
      return {
        ok: false,
        message: `Pool created more than ${Math.round(config.poolMaxAgeMs / 1000)}s ago`,
        code: LOG_CODES.SKIP_POOL_AGE,
      };
    }
    
    logger.debug({ 
      pool, 
      poolAge: Math.round(poolAge / 1000), 
      maxAge: Math.round(config.poolMaxAgeMs / 1000) 
    }, 'Pool age check passed');
    
    return {
      ok: true,
      message: `Pool age OK: ${Math.round(poolAge / 1000)}s`,
    };
  } catch (error) {
    logger.error({ error, pool }, 'Pool age filter failed');
    return {
      ok: false,
      message: 'Pool age check failed',
      code: LOG_CODES.SKIP_POOL_AGE,
    };
  }
}

async function getBlockTime(connection: Connection, mint: PublicKey): Promise<number> {
  const signatures = await connection.getSignaturesForAddress(mint, {
    limit: 1,
  });

  if (signatures.length === 0) {
    throw new Error('No transactions found for this account');
  }

  const lastSignature = signatures[signatures.length - 1];
  if (!lastSignature) {
    throw new Error('No signatures found');
  }

  const creationSignature = lastSignature.signature;

  const tx = await connection.getTransaction(creationSignature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.blockTime) {
    throw new Error(`No transaction found by signature [${creationSignature}]`);
  }

  return tx.blockTime;
}
