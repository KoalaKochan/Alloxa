import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, FilterResult, TOKEN_2022_PROGRAM_ID } from '../core/types';
import { logger, LOG_CODES } from '../utils/logger';

export async function checkToken2022(connection: Connection, pool: DetectedPool): Promise<FilterResult> {
  try {
    logger.debug({ pool }, 'Checking Token-2022 extensions');
    
    // Получаем информацию о токене
    const mintAccount = await connection.getAccountInfo(new PublicKey(pool.baseMint), connection.commitment);
    
    if (!mintAccount?.data) {
      logger.debug({ pool }, 'Mint account not found');
      return {
        ok: false,
        message: 'Mint account not found',
        code: LOG_CODES.SKIP_TOKEN2022_EXTENSION,
      };
    }

    // Проверяем, что токен использует Token-2022 программу
    const isToken2022 = mintAccount.owner.toBase58() === TOKEN_2022_PROGRAM_ID;
    
    if (!isToken2022) {
      logger.debug({ pool }, 'Not a Token-2022 token, check passed');
      return {
        ok: true,
        message: 'Not a Token-2022 token',
      };
    }

    const extensions = await getToken2022Extensions(connection, pool.baseMint);
    
    if (extensions.length === 0) {
      logger.debug({ pool }, 'No Token-2022 extensions found');
      return {
        ok: true,
        message: 'No Token-2022 extensions found',
      };
    }

    // Проверяем, что расширения не в списке запрещенных
    const hasDeniedExtensions = extensions.some(ext => 
      ['transfer_fee', 'permanent_delegate'].includes(ext)
    );

    if (hasDeniedExtensions) {
      const deniedExts = extensions.filter(ext => 
        ['transfer_fee', 'permanent_delegate'].includes(ext)
      );
      
      logger.debug({ pool, deniedExtensions: deniedExts }, 'Token-2022 has denied extensions');
      return {
        ok: false,
        message: `Token-2022 has denied extensions: ${deniedExts.join(', ')}`,
        code: LOG_CODES.SKIP_TOKEN2022_EXTENSION,
      };
    }

    logger.debug({ pool, extensions }, 'Token-2022 check passed');
    
    return {
      ok: true,
      message: 'Token-2022 extensions are acceptable',
    };
  } catch (error) {
    logger.error({ error, pool }, 'Token-2022 filter failed');
    return {
      ok: false,
      message: 'Token-2022 check failed',
      code: LOG_CODES.SKIP_TOKEN2022_EXTENSION,
    };
  }
}

async function getToken2022Extensions(connection: Connection, mintAddress: string): Promise<string[]> {
  try {
    const mintAccount = await connection.getAccountInfo(new PublicKey(mintAddress), connection.commitment);
    
    if (!mintAccount?.data) {
      return [];
    }

    if (mintAccount.owner.toBase58() !== TOKEN_2022_PROGRAM_ID) {
      return [];
    }

    const extensions: string[] = [];
    
    try {
      // Базовый размер mint account для Token-2022
      const baseMintSize = 82;
      const data = mintAccount.data;
      
      if (data.length <= baseMintSize) {
        return [];
      }
      
      // Читаем расширения (упрощенная версия)
      // В реальности нужно парсить структуру расширений Token-2022
      let offset = baseMintSize;
      
      while (offset < data.length - 1) {
        const extensionType = data.readUInt16LE(offset);
        offset += 2;
        
        const dataLength = data.readUInt16LE(offset);
        offset += 2;
        
        offset += dataLength;
        
        const extensionName = getExtensionName(extensionType);
        if (extensionName) {
          extensions.push(extensionName);
        }
        
        if (offset >= data.length) {
          break;
        }
      }
    } catch (parseError) {
      logger.debug({ error: parseError, mintAddress }, 'Failed to parse Token-2022 extensions');
    }
    
    return extensions;
  } catch (error) {
    logger.debug({ error, mintAddress }, 'Failed to get Token-2022 extensions');
    return [];
  }
}

function getExtensionName(extensionType: number): string | null {
  // Маппинг типов расширений Token-2022
  const extensionTypes: { [key: number]: string } = {
    1: 'transfer_fee',
    2: 'interest_bearing_mint',
    3: 'cpi_guard',
    4: 'permanent_delegate',
    5: 'transfer_hook',
    6: 'metadata_pointer',
    7: 'token_group',
    8: 'group_member_pointer',
    9: 'group_pointer',
    10: 'default_account_state',
    11: 'memo_transfer',
    12: 'pausable',
    13: 'scaled_ui_amount',
  };
  
  return extensionTypes[extensionType] || null;
}
