import { Connection } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { config } from '../utils/config';
import { HoldersService } from '../services/holders.service';

export async function checkHolderConcentration(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking holder concentration');
    
    const holdersService = new HoldersService(connection);
    const concentration = await holdersService.getHolderConcentration(pool.baseMint, 5);
    
    if (concentration.top1 > config.holdersTop1MaxRatio) {
      return {
        ok: false,
        message: `Top-1 holder concentration ${concentration.top1} exceeds limit ${config.holdersTop1MaxRatio}`,
        code: LOG_CODES.SKIP_HOLDER_CONCENTRATION,
      };
    }
    
    if (concentration.top5 > config.holdersTop5MaxRatio) {
      return {
        ok: false,
        message: `Top-5 holder concentration ${concentration.top5} exceeds limit ${config.holdersTop5MaxRatio}`,
        code: LOG_CODES.SKIP_HOLDER_CONCENTRATION,
      };
    }
    
    logger.debug({ 
      pool, 
      top1: concentration.top1, 
      top5: concentration.top5 
    }, 'Holder concentration check passed');
    
    return {
      ok: true,
      message: 'Holder concentration check passed',
    };
  } catch (error) {
    logger.error({ error, pool }, 'Holder concentration filter failed');
    return {
      ok: false,
      message: 'Holder concentration check failed',
      code: LOG_CODES.SKIP_HOLDER_CONCENTRATION,
    };
  }
}
