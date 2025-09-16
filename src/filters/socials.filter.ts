import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';
import { config } from '../utils/config';
import { getPdaMetadataKey } from '@raydium-io/raydium-sdk';
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';

export async function checkSocials(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking socials in metadata');
    
    const metadataPDA = getPdaMetadataKey(new PublicKey(pool.baseMint));
    const metadataAccount = await connection.getAccountInfo(metadataPDA.publicKey, connection.commitment);

    if (!metadataAccount?.data) {
      logger.debug({ pool }, 'Metadata account not found - skipping socials check');
      return {
        ok: true,
        message: 'No metadata - skipping socials check',
      };
    }

    const metadataSerializer = getMetadataAccountDataSerializer();
    const deserialize = metadataSerializer.deserialize(metadataAccount.data);
    const metadata = deserialize[0];

    // Проверяем наличие социальных сетей
    const socialLinksCount = await countSocialLinks(metadata);
    
    if (socialLinksCount < config.minSocialLinks) {
      logger.debug({ pool, found: socialLinksCount, required: config.minSocialLinks }, 'Insufficient social links');
      return {
        ok: false,
        message: `Found ${socialLinksCount} social links, required ${config.minSocialLinks}`,
        code: LOG_CODES.SKIP_NO_SOCIALS,
      };
    }

    logger.debug({ pool, found: socialLinksCount, required: config.minSocialLinks }, 'Socials check passed');
    return {
      ok: true,
      message: `Found ${socialLinksCount} social links (required: ${config.minSocialLinks})`,
    };
  } catch (error) {
    logger.error({ error, pool }, 'Socials filter failed');
    return {
      ok: false,
      message: 'Socials check failed',
      code: LOG_CODES.SKIP_NO_SOCIALS,
    };
  }
}

async function countSocialLinks(metadata: any): Promise<number> {
  try {
    if (!metadata.uri) {
      return 0;
    }

    const response = await fetch(metadata.uri);
    if (!response.ok) {
      return 0;
    }

    const data = await response.json();
    
    // Упрощенная проверка социальных ссылок
    // TODO: Подключить Solscan API для более точной проверки социальных сетей
    // Пример: https://public-api.solscan.io/token/meta?tokenAddress={mintAddress}
    
    // Проверяем основные поля - просто наличие поля, не содержимое
    const mainFields = ['twitter', 'telegram', 'discord', 'github', 'medium', 'website'];
    let socialCount = 0;
    
    for (const field of mainFields) {
      const value = data[field];
      if (value && typeof value === 'string' && value.trim() !== '') {
        socialCount++;
      }
    }
    
    // Проверяем extensions - просто наличие поля, не содержимое
    if (data.extensions) {
      for (const value of Object.values(data.extensions)) {
        if (value && typeof value === 'string' && value.trim() !== '') {
          socialCount++;
        }
      }
    }
    
    logger.debug({ 
      socialCount,
      checkedFields: mainFields,
      data: JSON.stringify(data, null, 2).substring(0, 200)
    }, 'Social links check');

    return socialCount;
  } catch (error) {
    logger.debug({ error }, 'Failed to check social links');
    return 0;
  }
}
