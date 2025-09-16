import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, logFilterStart, logFilterPass, logFilterFail, logPoolAccepted, logPoolRejected } from '../utils/logger';
import { config } from '../utils/config';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';

// Импортируем все фильтры
import { checkMutable } from './mutable.filter';
import { checkSocials } from './socials.filter';
import { checkRenounced } from './renounced.filter';
import { checkPoolAge } from './pool-age.filter';
import { checkImage } from './image.filter';
import { checkPoolSize } from './pool-size.filter';
import { checkHolderConcentration } from './holder-concentration.filter';
import { checkToken2022 } from './token2022.filter';
import { checkLpProtection } from './lp-protection.filter';
import { RouteAndImpactFilter } from './route-and-impact.filter';

export interface FilterManagerConfig {
  connection: Connection;
}

export class FilterManager {
  private connection: Connection;
  private routeFilter: RouteAndImpactFilter;

  constructor(config: FilterManagerConfig) {
    this.connection = config.connection;
    this.routeFilter = new RouteAndImpactFilter(this.connection);
  }

  private async getTokenName(mint: string): Promise<{ name: string; symbol: string }> {
    try {
      const metadataPDA = getPdaMetadataKey(new PublicKey(mint));
      const metadataAccount = await this.connection.getAccountInfo(metadataPDA.publicKey, this.connection.commitment);
      
      if (!metadataAccount?.data) {
        return { name: 'Unknown (no metadata)', symbol: 'Unknown' };
      }

      const metadataSerializer = getMetadataAccountDataSerializer();
      const deserialize = metadataSerializer.deserialize(metadataAccount.data);
      const metadata = deserialize[0];

      return {
        name: metadata.name || 'Unknown',
        symbol: metadata.symbol || 'Unknown'
      };
    } catch (error) {
      logger.debug({ error, mint }, 'Failed to get token name');
      return { name: 'Unknown (error)', symbol: 'Unknown' };
    }
  }

  async checkPool(pool: DetectedPool): Promise<{
    passed: boolean;
    results: { [key: string]: FilterResult };
    failedFilters: string[];
  }> {
    const results: { [key: string]: FilterResult } = {};
    const failedFilters: string[] = [];

    logger.debug({ pool }, 'Starting filter checks');

    const filterChecks = [
      { name: 'route-gate', check: () => this.routeFilter.execute(pool) },
      { name: 'mutable', check: () => checkMutable(this.connection, pool) },
      { name: 'renounced', check: () => checkRenounced(this.connection, pool) },
      { name: 'token2022', check: () => checkToken2022(this.connection, pool) },
      { name: 'socials', check: () => checkSocials(this.connection, pool) },
      { name: 'image', check: () => checkImage(this.connection, pool) },
      { name: 'pool-size', check: () => checkPoolSize(this.connection, pool) },
      { name: 'pool-age', check: () => checkPoolAge(this.connection, pool) },
      { name: 'holder-concentration', check: () => checkHolderConcentration(this.connection, pool) },
      { name: 'lp-protection', check: () => checkLpProtection(this.connection, pool) }
    ];

    for (const { name, check } of filterChecks) {
      const startTime = Date.now();
      try {
        logFilterStart(name, pool.baseMint);
        
        const result = await check();
        const duration = Date.now() - startTime;

        results[name] = result;

        if (!result.ok) {
          failedFilters.push(name);
          logFilterFail(name, pool.baseMint, result.message || 'Unknown error', duration);
          logger.debug({ 
            filter: name, 
            pool: pool.baseMint, 
            message: result.message,
            duration 
          }, 'Filter failed');
        } else {
          logFilterPass(name, pool.baseMint, duration);
          logger.debug({ 
            filter: name, 
            pool: pool.baseMint, 
            duration 
          }, 'Filter passed');
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        logFilterFail(name, pool.baseMint, error instanceof Error ? error.message : 'Unknown error', duration);
        logger.error({ error, filter: name, pool: pool.baseMint }, 'Filter execution failed');
        results[name] = {
          ok: false,
          message: `Filter execution failed: ${error instanceof Error ? error.message : String(error)}`
        };
        failedFilters.push(name);
      }
    }

    const passed = failedFilters.length === 0;
    
    // Получаем название токена
    const tokenInfo = await this.getTokenName(pool.baseMint);
    
    // Логируем результат проверки пула
    if (passed) {
      logPoolAccepted(pool.poolId, pool.dex, 'All filters passed', tokenInfo.name, tokenInfo.symbol);
    } else {
      logPoolRejected(pool.poolId, pool.dex, `Failed ${failedFilters.length} filters`, failedFilters, tokenInfo.name, tokenInfo.symbol);
      // Логируем дубликат для метрик
      logger.info({
        code: 'POOL_REJECTED',
        dex: pool.dex,
        poolId: pool.poolId,
        baseMint: pool.baseMint,
        quoteMint: pool.quoteMint,
        tokenName: tokenInfo.name,
        tokenSymbol: tokenInfo.symbol
      }, 'POOL_REJECTED');
    }
    
    logger.info({
      pool: pool.baseMint,
      passed,
      failedFilters,
      totalFilters: filterChecks.length,
      results: Object.keys(results).reduce((acc, key) => {
        acc[key] = results[key]?.ok ?? false;
        return acc;
      }, {} as { [key: string]: boolean })
    }, 'Filter check completed');

    return { passed, results, failedFilters };
  }

  async checkPoolConsecutive(pool: DetectedPool): Promise<{
    passed: boolean;
    results: { [key: string]: FilterResult };
  }> {
    const requiredMatches = config.consecutiveFilterMatches;
    
    for (let i = 0; i < requiredMatches; i++) {
      const { passed, results } = await this.checkPool(pool);
      
      if (!passed) {
        logger.debug({ 
          pool: pool.baseMint, 
          attempt: i + 1, 
          required: requiredMatches 
        }, 'Consecutive check failed');
        return { passed: false, results };
      }
      
      logger.debug({ 
        pool: pool.baseMint, 
        attempt: i + 1, 
        required: requiredMatches 
      }, 'Consecutive check passed');
      
      // Ждем между проверками (кроме последней)
      if (i < requiredMatches - 1) {
        await new Promise(resolve => setTimeout(resolve, config.filterCheckInterval));
      }
    }
    
    // Все проверки прошли
    logger.debug({ 
      pool: pool.baseMint, 
      attempt: 0, 
      required: requiredMatches 
    }, 'Consecutive check passed');
    
    return { passed: true, results: {} };
  }
}