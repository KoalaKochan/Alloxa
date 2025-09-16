import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { MintLayout } from '@solana/spl-token';

export async function checkRenounced(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking renounced mint authority');
  
    const mintAccount = await connection.getAccountInfo(new PublicKey(pool.baseMint), connection.commitment);
    
    if (!mintAccount?.data) {
      logger.debug({ pool }, 'Mint account not found');
      return {
        ok: false,
        message: 'Mint account not found',
        code: LOG_CODES.SKIP_RENOUNCED,
      };
    }

    if (mintAccount.data.length < MintLayout.span) {
      logger.debug({ pool, dataLength: mintAccount.data.length, expectedLength: MintLayout.span }, 'Mint account data too small');
      return {
        ok: false,
        message: 'Mint account data too small',
        code: LOG_CODES.SKIP_RENOUNCED,
      };
    }

    const mintData = MintLayout.decode(mintAccount.data);
    
    const isMintRenounced = mintData.mintAuthorityOption === 0;
    
    const isFreezeRenounced = mintData.freezeAuthorityOption === 0;
    
    if (!isMintRenounced) {
      logger.warn({ pool }, 'Mint authority not renounced - blocking token');
      return {
        ok: false,
        message: 'Mint authority not renounced',
        code: LOG_CODES.SKIP_RENOUNCED,
      };
    }
    
    if (!isFreezeRenounced) {
      logger.warn({ pool }, 'Freeze authority not renounced - blocking token');
      return {
        ok: false,
        message: 'Freeze authority not renounced',
        code: LOG_CODES.SKIP_RENOUNCED,
      };
    }

    logger.debug({ pool }, 'Renounced check passed');
    return {
      ok: true,
      message: 'Mint and freeze authorities renounced',
    };
  } catch (error) {
    logger.error({ error, pool }, 'Renounced filter failed');
    return {
      ok: false,
      message: 'Renounced check failed',
      code: LOG_CODES.SKIP_RENOUNCED,
    };
  }
}
