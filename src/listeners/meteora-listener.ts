import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool } from '../core/types';
import { logger } from '../utils/logger';
import { decodePoolFromTx as decodeMeteoraPool } from '../decoders/meteora.decoder';
import { BaseListener } from './base-listener';

const METEORA_PROGRAM_ID = new PublicKey('Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB');

export class MeteoraListener extends BaseListener {
  private subscriptionId: number | undefined;

  constructor(connection: Connection, bot: any) {
    super(connection, bot);
  }

  getDexName(): string {
    return 'meteora';
  }

  getProgramId(): PublicKey {
    return METEORA_PROGRAM_ID;
  }

  decodePoolsFromTx(tx: any): DetectedPool[] {
    return decodeMeteoraPool(tx);
  }

  async start(): Promise<void> {
    await this.startListener();
    
    await this.performBackfill();
    
    this.subscriptionId = this.connection.onProgramAccountChange(
      this.getProgramId(),
      async (accountInfo, _context) => {
        if (!this.isRunning) return;
        
        // ВРЕМЕННО: ослабляем фильтр для тестирования
        // Проверяем только что аккаунт принадлежит программе Meteora
        if (accountInfo.accountInfo.owner.toString() !== this.getProgramId().toString()) {
          return;
        }
        
        if (accountInfo.accountInfo.data.length !== 952) {
          return;
        }
        
        
        logger.debug({ 
          dex: this.getDexName(),
          slot: _context.slot,
          lamports: accountInfo.accountInfo.lamports,
          dataLength: accountInfo.accountInfo.data.length
        }, 'New pool account detected');
        
        try {
          // Используем очередь для rate limiting
          // Для onProgramAccountChange используем accountInfo.accountId
          const tx = await this.bot.addToQueue(async () => {
            const signatures = await this.connection.getSignaturesForAddress(accountInfo.accountId, { limit: 1 });
            if (signatures.length === 0) return null;
            
            return await this.connection.getParsedTransaction(signatures[0]?.signature || '', {
              maxSupportedTransactionVersion: 0,
            });
          });
          
          if (tx) {
            await this.processTransaction(tx);
          }
        } catch (error) {
          logger.debug({ error }, 'Failed to get Meteora transaction');
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
      // Для Meteora пока возвращаем простую структуру
      // TODO: Реализовать правильное декодирование согласно спецификации Meteora
      logger.debug('Meteora pool state decoding - using mock data',data);
      
      // Возвращаем базовую структуру для тестирования
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
      logger.debug({ error }, 'Failed to decode Meteora pool state');
      throw error;
    }
  }

}