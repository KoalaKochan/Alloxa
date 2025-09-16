import { Connection } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { JupiterService } from '../services/jupiter.service';
import { config } from '../utils/config';
import { logger, LOG_CODES } from '../utils/logger';
import { Token } from '@raydium-io/raydium-sdk';

export class RouteAndImpactFilter {
  private jupiterService: JupiterService;

  constructor(connection: Connection) {
    this.jupiterService = new JupiterService(connection);
  }

  async execute(pool: DetectedPool): Promise<FilterResult> {
    try {

      const buyAmount = Math.floor(config.buyAmount * 1e9).toString();

      const routeCheck = await this.jupiterService.checkRoute(
        Token.WSOL.mint.toString(),
        pool.baseMint,
        buyAmount
      );

      if (!routeCheck) {
        logger.debug({
          mint: pool.baseMint,
          reason: 'Route not available on Jupiter (new token)',
        }, 'Route check failed - new token not yet tradable');
        
        // Токен не найден на Jupiter - отклоняем
        logger.debug({
          mint: pool.baseMint,
          reason: 'Token not found on Jupiter'
        }, 'Route filter rejecting token - not on Jupiter');
        
        return {
          ok: false,
          message: 'Token not found on Jupiter',
        };
      }

      // Получаем дополнительную информацию о маршруте
      const routeInfo = await this.jupiterService.getRouteInfo(
        Token.WSOL.mint.toString(),
        pool.baseMint,
        buyAmount
      );

      const priceImpact = routeInfo?.priceImpactPct ? parseFloat(routeInfo.priceImpactPct) : 0;
      const priceImpactBps = Math.round(priceImpact * 100); // Конвертируем в базисные пункты
      
      if (priceImpactBps > config.maxPriceImpactBps) {
        logger.debug({
          mint: pool.baseMint,
          priceImpactBps,
          maxPriceImpactBps: config.maxPriceImpactBps,
          reason: 'Price impact too high',
        }, 'Price impact check failed');
        
        return {
          ok: false,
          message: `Price impact too high: ${priceImpactBps}bps > ${config.maxPriceImpactBps}bps`,
          code: LOG_CODES.SKIP_IMPACT_GT_LIMIT,
        };
      }
      
      logger.info({
        mint: pool.baseMint,
        priceImpactBps,
        maxPriceImpactBps: config.maxPriceImpactBps,
        routeSteps: routeInfo?.routePlan?.length || 0,
        swapMode: routeInfo?.swapMode,
      }, 'Route and impact check passed');

      return {
        ok: true,
        message: `Route and impact check passed (${priceImpact.toFixed(2)}% impact, ${priceImpactBps}bps)`,
      };

    } catch (error) {
      logger.error({ error, pool }, 'Route and impact filter failed');
      return {
        ok: false,
        message: 'Route check failed',
        code: LOG_CODES.SKIP_ROUTE_NOT_FOUND,
      };
    }
  }
}
