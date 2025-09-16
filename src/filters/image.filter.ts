import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';

export async function checkImage(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking image in metadata');
    
    // Получаем метаданные токена
    const metadataPDA = getPdaMetadataKey(new PublicKey(pool.baseMint));
    const metadataAccount = await connection.getAccountInfo(metadataPDA.publicKey, connection.commitment);
    
    if (!metadataAccount?.data) {
      logger.debug({ 
        pool, 
        baseMint: pool.baseMint,
        tokenName: 'Unknown (no metadata)',
        metadataPDA: metadataPDA.publicKey.toBase58()
      }, 'Metadata account not found - skipping image check');
      return {
        ok: true,
        message: 'No metadata - skipping image check',
      };
    }

    // Декодируем метаданные
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

    // Проверяем наличие изображения
    const hasValidImage = await checkImageValidity(metadata);
    
    if (!hasValidImage) {
      logger.debug({ pool }, 'No valid image found');
      return {
        ok: false,
        message: 'No valid image found',
        code: LOG_CODES.SKIP_NO_IMAGE,
      };
    }

    logger.debug({ pool }, 'Image check passed');
    return {
      ok: true,
      message: 'Valid image found',
    };
  } catch (error) {
    logger.error({ error, pool }, 'Image filter failed');
    return {
      ok: false,
      message: 'Image check failed',
      code: LOG_CODES.SKIP_NO_IMAGE,
    };
  }
}

async function checkImageValidity(metadata: any): Promise<boolean> {
  try {
    if (!metadata.uri) {
      return false;
    }

    const response = await fetch(metadata.uri);
    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    
    // Проверяем наличие поля image
    if (!data.image || typeof data.image !== 'string') {
      return false;
    }

    const imageUrl = data.image;
    
    // Проверяем, что это валидный URL
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('ipfs://')) {
      return false;
    }

    // Проверяем доступность изображения
    try {
      const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
      if (!imageResponse.ok) {
        return false;
      }

      const contentType = imageResponse.headers.get('content-type');
      if (!contentType || (!contentType.startsWith('image/') && !contentType.includes('gif'))) {
        return false;
      }

      return true;
    } catch (error) {
      logger.debug({ error, imageUrl }, 'Failed to check image availability');
      return false;
    }
  } catch (error) {
    logger.debug({ error }, 'Failed to check image validity');
    return false;
  }
}
