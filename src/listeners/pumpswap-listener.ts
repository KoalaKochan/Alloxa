import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool, DEX_PROGRAM_IDS } from '../core/types';
import { logger } from '../utils/logger';
import { decodePoolFromTx as decodePumpSwapPool } from '../decoders/pumpswap.decoder';
import { BaseListener } from './base-listener';

const PUMPSWAP_PROGRAM_ID = new PublicKey(DEX_PROGRAM_IDS.PUMPSWAP);

export class PumpSwapListener extends BaseListener {
  private subscriptionId: number | undefined;

  constructor(connection: Connection, bot: any) {
    super(connection, bot);
  }

  getDexName(): string {
    return 'pumpswap';
  }

  getProgramId(): PublicKey {
    return PUMPSWAP_PROGRAM_ID;
  }

  decodePoolsFromTx(tx: any): DetectedPool[] {
    return decodePumpSwapPool(tx);
  }

  async start(): Promise<void> {
    await this.startListener();
    
    await this.performBackfill();
    
    this.subscriptionId = this.connection.onProgramAccountChange(
      this.getProgramId(),
      async (accountInfo, _context) => {
        if (!this.isRunning) return;
        
        // ВРЕМЕННО: ослабляем фильтр для тестирования
        // Проверяем только что аккаунт принадлежит программе PumpSwap
        if (accountInfo.accountInfo.owner.toString() !== this.getProgramId().toString()) {
          return;
        }
        
        // Фильтруем только аккаунты пулов PumpSwap (размер данных 150 байт)
        if (accountInfo.accountInfo.data.length !== 150) {
          return;
        }
        
        // Дополнительная проверка: lamports должны быть в разумном диапазоне для нового пула
        if (accountInfo.accountInfo.lamports < 1000000 || accountInfo.accountInfo.lamports > 1000000000000) {
          return;
        }
        
        logger.debug({ 
          dex: this.getDexName(),
          slot: _context.slot,
          lamports: accountInfo.accountInfo.lamports,
          dataLength: accountInfo.accountInfo.data.length
        }, 'New pool account detected');
        
        try {
          const tx = await this.bot.addToQueue(async () => {
            const signatures = await this.connection.getSignaturesForAddress(accountInfo.accountId, { limit: 1 });
            if (signatures.length === 0) return null;
            
            return await this.connection.getTransaction(signatures[0]?.signature || '', {
              maxSupportedTransactionVersion: 0,
            });
          });
          
          if (tx) {
            await this.processTransaction(tx);
          }
        } catch (error) {
          logger.debug({ error }, 'Failed to get PumpSwap transaction');
        }
      },
      { commitment: 'confirmed' }
    );

    // logListenerReady(this.getDexName(), 'account-change');
  }

  async stop(): Promise<void> {
    await this.stopListener();
    
    if (this.subscriptionId !== undefined) {
      await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
      this.subscriptionId = undefined;
    }
  }

  protected decodePoolState(data: Buffer): any {
    try {
      // Для PumpSwap пока возвращаем простую структуру
      // TODO: Реализовать правильное декодирование согласно спецификации PumpSwap
      logger.debug('PumpSwap pool state decoding - using mock data', data);
      
      return {
        baseMint: null, 
        quoteMint: null, 
        marketId: null,
        quoteReserve: BigInt(1000000), 
        baseReserve: BigInt(1000000), 
        baseDecimal: 9,
        quoteDecimal: 9,
        lpMint: null,
        openOrders: null,
        targetOrders: null,
        baseVault: null,
        quoteVault: null,
        marketProgramId: null
      };
    } catch (error) {
      logger.debug({ error }, 'Failed to decode PumpSwap pool state');
      throw error;
    }
  }
}