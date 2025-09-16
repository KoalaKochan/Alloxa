import { ParsedTransactionWithMeta } from '@solana/web3.js';
import { DetectedPool } from '../core/types';

export { decodePoolFromTx as decodeRaydiumPool } from './raydium.decoder';
export { decodePoolFromTx as decodeMeteoraPool } from './meteora.decoder';
export { decodePoolFromTx as decodePumpSwapPool } from './pumpswap.decoder';
export { BaseDecoder, DecoderConfig } from './base-decoder';

// Универсальная функция для декодирования пулов из всех DEX
export async function decodeAllPools(tx: ParsedTransactionWithMeta): Promise<DetectedPool[]> {
  const allPools: DetectedPool[] = [];
  
  // Импортируем декодеры динамически для избежания циклических зависимостей
  const { decodePoolFromTx: decodeRaydiumPool } = await import('./raydium.decoder');
  const { decodePoolFromTx: decodeMeteoraPool } = await import('./meteora.decoder');
  const { decodePoolFromTx: decodePumpSwapPool } = await import('./pumpswap.decoder');
  
  // Декодируем пулы из всех DEX
  allPools.push(...decodeRaydiumPool(tx));
  allPools.push(...decodeMeteoraPool(tx));
  allPools.push(...decodePumpSwapPool(tx));
  
  return allPools;
}
