// import { Transaction } from '@solana/web3.js';
import { DetectedPool,  } from '../core/types';
import { logger } from '../utils/logger';
// import { getPublicKeyStringByIndex } from '../utils/account-utils';

export function decodePoolFromTx(tx: any): DetectedPool[] {
  const pools: DetectedPool[] = [];
  
  try {
    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      hasInnerInstructions: !!tx.meta?.innerInstructions,
      innerInstructionsCount: tx.meta?.innerInstructions?.length || 0,
      mainInstructionsCount: tx.transaction.message.instructions?.length || 0
    }, 'Decoding PumpSwap transaction');

    // Проверяем main instructions
    if (tx.transaction.message.instructions) {
      for (const instruction of tx.transaction.message.instructions) {
          logger.debug({
          signature: tx.transaction.signatures[0]?.toString() || 'unknown',
          programId: instruction.programId?.toString() || 'unknown'
        }, 'Checking main instruction');
        
        // Не проверяем programId - мы уже подписаны на PumpSwap программу
          const pool = decodePumpSwapInstruction(instruction, tx);
          if (pool) {
            pools.push(pool);
        }
      }
    }

    // Проверяем inner instructions
    if (tx.meta?.innerInstructions) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        innerInstructionsCount: tx.meta.innerInstructions.length
      }, 'Checking inner instructions for PumpSwap');
      
      for (const innerInstruction of tx.meta.innerInstructions) {
        for (const instruction of innerInstruction.instructions) {
            logger.debug({
            signature: tx.transaction.signatures[0]?.toString() || 'unknown',
            programId: instruction.programId?.toString() || 'unknown',
            instructionType: typeof instruction,
            instructionKeys: Object.keys(instruction)
          }, 'Checking PumpSwap inner instruction');
          
          // Не проверяем programId - мы уже подписаны на PumpSwap программу
            const pool = decodePumpSwapInstruction(instruction, tx);
            if (pool) {
              pools.push(pool);
          }
        }
      }
    }
  } catch (error) {
    logger.debug({ error }, 'Failed to decode PumpSwap transaction');
  }

  logger.debug({
    signature: tx.transaction.signatures[0]?.toString() || 'unknown',
    poolsCount: pools.length
  }, 'PumpSwap decoding completed');

  return pools;
}

function decodePumpSwapInstruction(instruction: any, tx: any): DetectedPool | null {
  try {
    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      instructionType: typeof instruction,
      instructionKeys: Object.keys(instruction)
    }, 'Decoding PumpSwap instruction');

    // Для PumpSwap используем простой подход - берем аккаунты напрямую из instruction
    const accounts = instruction.accounts || [];
    
    if (accounts.length < 2) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        accountsCount: accounts.length
      }, 'PumpSwap instruction not enough accounts');
      return null;
    }

    // Извлекаем аккаунты из accountKeys по индексам
    const accountKeys = tx.transaction.message.accountKeys;
    
    if (!accountKeys || !Array.isArray(accountKeys)) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        hasAccountKeys: !!accountKeys,
        accountKeysType: typeof accountKeys
      }, 'PumpSwap instruction no accountKeys available');
      return null;
    }

    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      accountKeysLength: accountKeys.length,
      accountsIndices: [accounts[0], accounts[1], accounts[2], accounts[3]],
      accountsTypes: [typeof accounts[0], typeof accounts[1], typeof accounts[2], typeof accounts[3]]
    }, 'PumpSwap instruction account indices');
    
    // Проверяем, что все индексы аккаунтов находятся в пределах массива accountKeys
    if (accounts[0] >= accountKeys.length || accounts[1] >= accountKeys.length) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        accountKeysLength: accountKeys.length,
        accountsIndices: [accounts[0], accounts[1], accounts[2], accounts[3]]
      }, 'PumpSwap instruction account indices out of bounds');
      return null;
    }
    
    const poolId = accountKeys[accounts[0]]?.toString();
    const baseMint = accountKeys[accounts[1]]?.toString();
    const quoteMint = accounts.length > 2 && accounts[2] < accountKeys.length ? accountKeys[accounts[2]]?.toString() : '';
    const lpMint = accounts.length > 3 && accounts[3] < accountKeys.length ? accountKeys[accounts[3]]?.toString() : '';

    // Проверяем, что основные аккаунты найдены
    if (!poolId || !baseMint) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        poolId: !!poolId,
        baseMint: !!baseMint,
        quoteMint: !!quoteMint,
        lpMint: !!lpMint,
        accountKeysLength: accountKeys.length,
        accountsIndices: [accounts[0], accounts[1], accounts[2], accounts[3]]
      }, 'PumpSwap instruction missing required accounts');
      return null;
    }

    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      poolId,
      baseMint,
      quoteMint,
      lpMint
    }, 'PumpSwap instruction accounts');

    if (!poolId || !baseMint || !quoteMint) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        poolId: !!poolId,
        baseMint: !!baseMint,
        quoteMint: !!quoteMint
      }, 'PumpSwap instruction missing required accounts');
      return null;
    }

    logger.debug({
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      poolId,
      baseMint,
      quoteMint,
      lpMint
    }, 'PumpSwap instruction decoded successfully');

    return {
      dex: 'pumpswap',
      poolId: poolId,
      baseMint: baseMint,
      quoteMint: quoteMint,
      lpMint: lpMint || '',
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.debug({ error, signature: tx.transaction.signatures[0]?.toString() || 'unknown' }, 'Failed to decode PumpSwap instruction');
    return null;
  }
}