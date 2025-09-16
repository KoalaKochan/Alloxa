import { ParsedTransactionWithMeta } from '@solana/web3.js';
import { DetectedPool, DEX_PROGRAM_IDS } from '../core/types';
import { logger } from '../utils/logger';

export function decodePoolFromTx(tx: ParsedTransactionWithMeta): DetectedPool[] {
  const pools: DetectedPool[] = [];
  
  try {
    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      hasInnerInstructions: !!tx.meta?.innerInstructions,
      innerInstructionsCount: tx.meta?.innerInstructions?.length || 0,
      mainInstructionsCount: tx.transaction.message.instructions?.length || 0
    }, 'Decoding Meteora transaction');

    // Проверяем main instructions
    if (tx.transaction.message.instructions) {
      for (const instruction of tx.transaction.message.instructions) {
        if (instruction.programId?.toString() === DEX_PROGRAM_IDS.METEORA) {
          logger.debug({
            signature: tx.transaction.signatures[0]?.toString() || 'unknown',
            programId: instruction.programId?.toString() || 'unknown',
            isMeteora: true
          }, 'Found Meteora main instruction');
          
          const pool = decodeMeteoraInstruction(instruction, tx);
          if (pool) {
            pools.push(pool);
          }
        }
      }
    }

    // Также проверяем inner instructions
    if (tx.meta?.innerInstructions) {
      for (const innerInstruction of tx.meta.innerInstructions) {
        for (const instruction of innerInstruction.instructions) {
          if (instruction.programId?.toString() === DEX_PROGRAM_IDS.METEORA) {
            logger.debug({
              signature: tx.transaction.signatures[0]?.toString() || 'unknown',
              programId: instruction.programId?.toString() || 'unknown',
              isMeteora: true
            }, 'Found Meteora inner instruction');
            
            const pool = decodeMeteoraInstruction(instruction, tx);
            if (pool) {
              pools.push(pool);
            }
          }
        }
      }
    }
  } catch (error) {
    logger.debug({ error }, 'Failed to decode Meteora transaction');
  }

  logger.debug({
    signature: tx.transaction.signatures[0]?.toString() || 'unknown',
    poolsCount: pools.length
  }, 'Meteora decoding completed');

  return pools;
}

function decodeMeteoraInstruction(instruction: any, tx: ParsedTransactionWithMeta): DetectedPool | null {
  try {
    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      hasData: !!instruction.data,
      dataLength: instruction.data?.length || 0,
      accountsCount: instruction.accounts?.length || 0
    }, 'Decoding Meteora instruction');

    // Проверяем, что это инструкция создания пула
    if (instruction.data && instruction.data.length < 4) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        dataLength: instruction.data.length
      }, 'Meteora instruction data too short');
      return null;
    }

    // Декодируем discriminator (первые 4 байта)
    const discriminator = instruction.data?.slice(0, 4);
    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      discriminator: Array.from(discriminator || []).map((b: unknown) => (b as number).toString(16).padStart(2, '0')).join('')
    }, 'Meteora instruction discriminator');

    const accounts = instruction.accounts || [];
    
    // Для Meteora нужны минимум 6 аккаунтов
    if (accounts.length < 6) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        accountsCount: accounts.length
      }, 'Meteora instruction not enough accounts');
      return null;
    }

    // Извлекаем аккаунты согласно структуре Meteora
    const poolId = accounts[0]?.toString();
    const baseMint = accounts[1]?.toString();
    const quoteMint = accounts[2]?.toString();
    const lpMint = accounts[3]?.toString();

    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      poolId,
      baseMint,
      quoteMint,
      lpMint
    }, 'Meteora instruction accounts');

    if (!poolId || !baseMint || !quoteMint) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        poolId: !!poolId,
        baseMint: !!baseMint,
        quoteMint: !!quoteMint
      }, 'Meteora instruction missing required accounts');
      return null;
    }

    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      poolId,
      baseMint,
      quoteMint,
      lpMint
    }, 'Meteora instruction decoded successfully');

    return {
      dex: 'meteora',
      poolId,
      baseMint,
      quoteMint,
      lpMint,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.debug({ error, signature: tx.transaction.signatures[0]?.toString() || 'unknown' }, 'Failed to decode Meteora instruction');
    return null;
  }
}