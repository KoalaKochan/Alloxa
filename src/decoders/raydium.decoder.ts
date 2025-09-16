import { ParsedTransactionWithMeta } from '@solana/web3.js';
import { DetectedPool } from '../core/types';
import { logger } from '../utils/logger';
// import { getPublicKeyStringByIndex } from '../utils/account-utils';

export function decodePoolFromTx(tx: ParsedTransactionWithMeta): DetectedPool[] {
  const pools: DetectedPool[] = [];
  
  try {
    logger.debug({ 
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      hasInnerInstructions: !!tx.meta?.innerInstructions,
      innerInstructionsCount: tx.meta?.innerInstructions?.length || 0
    }, 'Decoding Raydium transaction');
    
    // Проверяем основные инструкции транзакции
    if (tx.transaction.message.instructions) {
      for (const instruction of tx.transaction.message.instructions) {
        logger.debug({ 
          signature: tx.transaction.signatures[0]?.toString() || 'unknown',
          programId: instruction.programId?.toString() || 'unknown',
          instructionType: typeof instruction,
          instructionKeys: Object.keys(instruction)
        }, 'Checking main instruction');
        
        // Не проверяем programId - мы уже подписаны на Raydium программу
        const accountsCount = 'accounts' in instruction ? instruction.accounts?.length || 0 : 0;
        logger.debug({ 
          signature: tx.transaction.signatures[0]?.toString() || 'unknown',
          accountsCount
        }, 'Found Raydium main instruction, decoding...');
        
        const pool = decodeRaydiumInstruction(instruction, tx);
        if (pool) {
          logger.debug({ 
            signature: tx.transaction.signatures[0]?.toString() || 'unknown',
            poolId: pool.poolId,
            baseMint: pool.baseMint,
            quoteMint: pool.quoteMint
          }, 'Successfully decoded Raydium pool from main instruction');
          pools.push(pool);
        } else {
          logger.debug({ 
            signature: tx.transaction.signatures[0]?.toString() || 'unknown'
          }, 'Failed to decode Raydium main instruction');
        }
      }
    }

                // Проверяем inner instructions (где обычно находятся Raydium инструкции)
                if (tx.meta?.innerInstructions) {
                  for (const innerInstructionGroup of tx.meta.innerInstructions) {
                    for (const instruction of innerInstructionGroup.instructions) {
                      logger.debug({ 
                        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
                        programId: instruction.programId?.toString() || 'unknown'
                      }, 'Found Raydium inner instruction, decoding...');
                      
                      // Не проверяем programId - мы уже подписаны на Raydium программу
                      const pool = decodeRaydiumInstruction(instruction, tx);
                      if (pool) {
                        logger.debug({ 
                          signature: tx.transaction.signatures[0]?.toString() || 'unknown',
                          poolId: pool.poolId,
                          baseMint: pool.baseMint,
                          quoteMint: pool.quoteMint
                        }, 'Successfully decoded Raydium pool from inner instruction');
                        pools.push(pool);
                      } else {
                        logger.debug({ 
                          signature: tx.transaction.signatures[0]?.toString() || 'unknown'
                        }, 'Failed to decode Raydium pool from inner instruction');
                      }
                    }
                  }
                }

  } catch (error) {
    logger.debug({ error }, 'Failed to decode Raydium transaction');
  }

  logger.debug({ 
    signature: tx.transaction.signatures[0]?.toString() || 'unknown',
    poolsCount: pools.length
  }, 'Raydium decoding completed');

  return pools;
}

function decodeRaydiumInstruction(instruction: any, tx: ParsedTransactionWithMeta): DetectedPool | null {
  try {
    // Проверяем тип инструкции
    if ('parsed' in instruction) {
      // ParsedInstruction - не можем декодировать, так как нет raw данных
      logger.debug({ 
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        instructionType: 'ParsedInstruction'
      }, 'Raydium ParsedInstruction - cannot decode without raw data');
      return null;
    }

    // Проверяем, что это PartiallyDecodedInstruction с данными
    if (!('data' in instruction) || !instruction.data) {
      logger.debug({ 
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        hasData: 'data' in instruction,
        dataLength: instruction.data?.length || 0
      }, 'Raydium instruction has no data');
      return null;
    }

    // Декодируем discriminator (первые 4 байта)
    const discriminator = instruction.data?.slice(0, 4);
    logger.debug({ 
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      discriminator: Array.from(discriminator || []).map((b: unknown) => (b as number).toString(16).padStart(2, '0')).join('')
    }, 'Raydium instruction discriminator');
    

    // Проверяем, что есть аккаунты
    if (!('accounts' in instruction) || !instruction.accounts) {
      logger.debug({ 
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        hasAccounts: 'accounts' in instruction,
        accountsLength: instruction.accounts?.length || 0
      }, 'Raydium instruction has no accounts');
      return null;
    }

    const accounts = instruction.accounts;
    
    // Для Raydium AMM V4 нужны минимум 4 аккаунта (poolId, baseMint, quoteMint, lpMint)
    if (accounts.length < 4) {
      logger.debug({ 
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        accountsLength: accounts.length,
        required: 4
      }, 'Raydium instruction has insufficient accounts');
      return null;
    }

    // Извлекаем аккаунты из accountKeys по индексам
    const accountKeys = tx.transaction.message.accountKeys;
    
    // Проверяем, что все индексы аккаунтов находятся в пределах массива accountKeys
    if (accounts[0] >= accountKeys.length || accounts[1] >= accountKeys.length || 
        accounts[2] >= accountKeys.length || accounts[3] >= accountKeys.length) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        accountKeysLength: accountKeys.length,
        accountsIndices: [accounts[0], accounts[1], accounts[2], accounts[3]]
      }, 'Raydium instruction account indices out of bounds');
      return null;
    }
    
    const poolId = accountKeys[accounts[0]]?.toString() || '';
    const baseMint = accountKeys[accounts[1]]?.toString() || '';
    const quoteMint = accountKeys[accounts[2]]?.toString() || '';
    const lpMint = accountKeys[accounts[3]]?.toString() || '';

    // Проверяем, что все аккаунты найдены
    if (!poolId || !baseMint || !quoteMint) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        poolId: !!poolId,
        baseMint: !!baseMint,
        quoteMint: !!quoteMint,
        lpMint: !!lpMint,
        accountKeysLength: accountKeys.length,
        accountsIndices: [accounts[0], accounts[1], accounts[2], accounts[3]]
      }, 'Raydium instruction missing required accounts');
      return null;
    }

    // Проверяем, что poolId не является системными программами
    const systemPrograms = [
      '11111111111111111111111111111111', // System Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
      'SysvarRent111111111111111111111111111111111', // Rent Sysvar
      'SysvarC1ock11111111111111111111111111111111', // Clock Sysvar
    ];

    if (systemPrograms.includes(poolId)) {
      logger.debug({
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        poolId,
        baseMint,
        quoteMint
      }, 'Raydium instruction poolId is a system program, skipping');
      return null;
    }

    logger.debug({ 
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      poolId,
      baseMint,
      quoteMint,
      lpMint,
      accountKeysLength: tx.transaction.message.accountKeys?.length || 0
    }, 'Raydium instruction accounts');

    if (!poolId || !baseMint || !quoteMint || !lpMint) {
      logger.debug({ 
        signature: tx.transaction.signatures[0]?.toString() || 'unknown',
        poolId: !!poolId,
        baseMint: !!baseMint,
        quoteMint: !!quoteMint,
        lpMint: !!lpMint
      }, 'Raydium instruction missing required accounts');
      return null;
    }

    logger.debug({ 
      signature: tx.transaction.signatures[0]?.toString() || 'unknown',
      poolId,
      baseMint,
      quoteMint
    }, 'Successfully decoded Raydium pool');

    return {
      dex: 'raydium-amm',
      poolId,
      baseMint,
      quoteMint,
      lpMint,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.debug({ error, signature: tx.transaction.signatures[0]?.toString() || 'unknown' }, 'Failed to decode Raydium instruction');
    return null;
  }
}
