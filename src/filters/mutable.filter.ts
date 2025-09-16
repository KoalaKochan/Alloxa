import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';

export async function checkMutable(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking mutable metadata');
    
    // Получаем PDA для метаданных токена
    const metadataPDA = getPdaMetadataKey(new PublicKey(pool.baseMint));
    const metadataAccount = await connection.getAccountInfo(metadataPDA.publicKey, connection.commitment);

    if (!metadataAccount?.data) {
      logger.debug({ 
        pool, 
        baseMint: pool.baseMint,
        tokenName: 'Unknown (no metadata)',
        metadataPDA: metadataPDA.publicKey.toBase58()
      }, 'Metadata account not found - skipping mutable check');
      return {
        ok: true,
        message: 'No metadata - skipping mutable check',
      };
    }

    const metadataSerializer = getMetadataAccountDataSerializer();
    const deserialize = metadataSerializer.deserialize(metadataAccount.data);
    const metadata = deserialize[0];

    const tokenName = metadata.name || 'Unknown';
    const tokenSymbol = metadata.symbol || 'Unknown';
    logger.debug({ 
      pool, 
      baseMint: pool.baseMint,
      tokenName,
      tokenSymbol,
      metadataPDA: metadataPDA.publicKey.toBase58()
    }, 'Token metadata found');

    // Проверяем, что метаданные не изменяемые
    if (metadata.isMutable) {
      logger.debug({ pool }, 'Metadata is mutable');
      return {
        ok: false,
        message: 'Metadata is mutable',
        code: LOG_CODES.SKIP_MUTABLE,
      };
    }

    logger.debug({ pool }, 'Mutable check passed');
    return {
      ok: true,
      message: 'Metadata is not mutable',
    };
  } catch (error) {
    logger.error({ error, pool }, 'Mutable filter failed');
    return {
      ok: false,
      message: 'Mutable check failed',
      code: LOG_CODES.SKIP_MUTABLE,
    };
  }
}
