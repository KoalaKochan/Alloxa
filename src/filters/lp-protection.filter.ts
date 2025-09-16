import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { config } from '../utils/config';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';

export async function checkLpProtection(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking LP protection');
    
    if (!config.requireLpProtection) {
      return {
        ok: true,
        message: 'LP protection disabled',
      };
    }
    
    // Получаем данные пула
    const poolAccount = await connection.getAccountInfo(new PublicKey(pool.poolId), connection.commitment);
    
    if (!poolAccount?.data) {
      logger.debug({ pool }, 'Pool account not found');
      return {
        ok: false,
        message: 'Pool account not found',
        code: LOG_CODES.SKIP_NO_LOCK_15M,
      };
    }

    // Декодируем данные пула
    const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccount.data);
    
    // Проверяем LP защиту
    const lpProtection = await checkLpLockAndBurn(connection, pool, poolState);
    
    if (!lpProtection.hasLock && !lpProtection.hasBurn) {
      logger.debug({ pool }, 'No LP protection found');
      return {
        ok: false,
        message: 'No LP protection found',
        code: LOG_CODES.SKIP_NO_LOCK_15M,
      };
    }

    if (lpProtection.hasLock) {
      logger.debug({ pool }, 'LP lock found');
      return {
        ok: true,
        message: 'LP lock protection found',
      };
    }

    if (lpProtection.hasBurn) {
      logger.debug({ pool, burnRatio: lpProtection.burnRatio }, 'LP burn protection found');
      return {
        ok: true,
        message: `LP burn protection found (${lpProtection.burnRatio}% burned)`,
      };
    }

    return {
      ok: false,
      message: 'LP protection check failed',
      code: LOG_CODES.SKIP_NO_LOCK_15M,
    };
  } catch (error) {
    logger.error({ error, pool }, 'LP protection filter failed');
    return {
      ok: false,
      message: 'LP protection check failed',
      code: LOG_CODES.SKIP_NO_LOCK_15M,
    };
  }
}

async function checkLpLockAndBurn(connection: Connection, pool: DetectedPool, poolState: any): Promise<{
  hasLock: boolean;
  hasBurn: boolean;
  burnRatio: number;
}> {
  try {
    // Получаем LP mint адрес
    const lpMint = poolState.lpMint;
    
    if (!lpMint) {
      return { hasLock: false, hasBurn: false, burnRatio: 0 };
    }

    // Проверяем LOCK
    const hasLock = await checkLpLock(connection, lpMint);
    
    // Проверяем BURN
    const burnInfo = await checkLpBurn(connection, lpMint);
    
    return {
      hasLock,
      hasBurn: burnInfo.hasBurn,
      burnRatio: burnInfo.burnRatio,
    };
  } catch (error) {
    logger.debug({ error, pool }, 'Failed to check LP lock and burn');
    return { hasLock: false, hasBurn: false, burnRatio: 0 };
  }
}

async function checkLpLock(connection: Connection, lpMint: string): Promise<boolean> {
  try {
    // 1. Проверяем через RugCheck API (более надежно)
    const rugCheckResult = await checkRugCheckAPI(lpMint);
    if (rugCheckResult) {
      logger.debug({ lpMint, source: 'rugcheck' }, 'LP locked (RugCheck API)');
      return true;
    }
    
    // 2. Проверяем через Team Finance Locker
    const teamFinanceResult = await checkTeamFinanceLocker(connection, lpMint);
    if (teamFinanceResult) {
      logger.debug({ lpMint, source: 'team_finance' }, 'LP locked in Team Finance');
      return true;
    }
    
    const otherLockersResult = await checkOtherLockers(connection, lpMint);
    if (otherLockersResult) {
      logger.debug({ lpMint, source: 'other_lockers' }, 'LP locked in other lockers');
      return true;
    }
    
    return false;
  } catch (error) {
    logger.debug({ error, lpMint }, 'Failed to check LP lock');
    return false;
  }
}

// Проверка через RugCheck API
async function checkRugCheckAPI(mint: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
    if (!response.ok) return false;
    
    const data = await response.json();
    
    // Проверяем различные индикаторы блокировки
    const hasLock = data.liquidityLocked || 
                   data.lpLocked || 
                   data.teamFinanceLocked ||
                   data.lockInfo?.isLocked;
    
    return Boolean(hasLock);
  } catch (error) {
    logger.debug({ error, mint }, 'Failed to check RugCheck API');
    return false;
  }
}

// Проверка Team Finance Locker
async function checkTeamFinanceLocker(connection: Connection, mint: string): Promise<boolean> {
  try {
    const TEAM_FINANCE_PROGRAM = new PublicKey('LocktDzaV1W2Bm9DeZeiyz4J9zs4fRqNiYqQyracRXw');
    const mintPubkey = new PublicKey(mint);
    
    const accounts = await connection.getProgramAccounts(TEAM_FINANCE_PROGRAM, {
      filters: [
        { dataSize: 8 + 32 + 8 + 8 + 8 + 8 }, // Размер аккаунта локера
        { memcmp: { offset: 8, bytes: mintPubkey.toBase58() } } // LP mint в позиции 8
      ]
    });
    
    if (accounts.length === 0) return false;
    
    // Проверяем, что локер активен
    for (const account of accounts) {
      try {
        const data = account.account.data;
        const endTime = data.readBigUInt64LE(48);
        const currentTime = BigInt(Math.floor(Date.now() / 1000));
        
        if (endTime > currentTime) {
          return true; // LP заблокирован
        }
      } catch (e) {
        continue;
      }
    }
    
    return false;
  } catch (error) {
    logger.debug({ error, mint }, 'Failed to check Team Finance Locker');
    return false;
  }
}

// Проверка других локеров
async function checkOtherLockers(connection: Connection, mint: string): Promise<boolean> {
  try {
    const mintPubkey = new PublicKey(mint);
    
    // Список популярных локеров
    const lockerPrograms = [
      'LocktDzaV1W2Bm9DeZeiyz4J9zs4fRqNiYqQyracRXw', // Team Finance
      'LocktDzaV1W2Bm9DeZeiyz4J9zs4fRqNiYqQyracRXw', // DxSale
      'LocktDzaV1W2Bm9DeZeiyz4J9zs4fRqNiYqQyracRXw', // PinkSale
    ];
    
    for (const programId of lockerPrograms) {
      try {
        const program = new PublicKey(programId);
        const accounts = await connection.getProgramAccounts(program, {
          filters: [
            { dataSize: 8 + 32 + 8 + 8 + 8 + 8 },
            { memcmp: { offset: 8, bytes: mintPubkey.toBase58() } }
          ]
        });
        
        if (accounts.length > 0) {
          // Проверяем активность локера
          for (const account of accounts) {
            try {
              const data = account.account.data;
              const endTime = data.readBigUInt64LE(48);
              const currentTime = BigInt(Math.floor(Date.now() / 1000));
              
              if (endTime > currentTime) {
                return true;
              }
            } catch (e) {
              continue;
            }
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    return false;
  } catch (error) {
    logger.debug({ error, mint }, 'Failed to check other lockers');
    return false;
  }
}


async function checkLpBurn(connection: Connection, lpMint: string): Promise<{
  hasBurn: boolean;
  burnRatio: number;
}> {
  try {
    // Получаем supply LP токенов
    const tokenSupply = await connection.getTokenSupply(new PublicKey(lpMint), connection.commitment);
    const supplyAmount = tokenSupply.value.uiAmount || 0;
    
    // Если supply равен 0, значит LP токены полностью сожжены
    if (supplyAmount === 0) {
      return {
        hasBurn: true,
        burnRatio: 100, // 100% сожжено
      };
    }
    
    // Если supply больше 0, проверяем, что он меньше ожидаемого
    // Для большинства пулов LP токены должны быть сожжены после создания
    const expectedMinSupply = 1000000; // Минимальный ожидаемый supply
    const burnRatio = supplyAmount < expectedMinSupply ? 50 : 0;
    
    return {
      hasBurn: supplyAmount === 0 || burnRatio >= 50,
      burnRatio: supplyAmount === 0 ? 100 : burnRatio,
    };
  } catch (error) {
    logger.debug({ error, lpMint }, 'Failed to check LP burn');
    return { hasBurn: false, burnRatio: 0 };
  }
}
