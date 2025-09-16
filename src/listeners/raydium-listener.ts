import { Connection, PublicKey } from '@solana/web3.js';
import { DetectedPool } from '../core/types';
import { logger } from '../utils/logger';
import { decodePoolFromTx as decodeRaydiumPool } from '../decoders/raydium.decoder';
import { BaseListener } from './base-listener';
import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';

const RAYDIUM_AMM_V4_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

export class RaydiumListener extends BaseListener {
  private subscriptionId: number | undefined;

  constructor(connection: Connection, bot: any) {
    super(connection, bot);
  }

  getDexName(): string {
    return 'raydium-amm';
  }

  getProgramId(): PublicKey {
    return RAYDIUM_AMM_V4_PROGRAM_ID;
  }

  decodePoolsFromTx(tx: any): DetectedPool[] {
    return decodeRaydiumPool(tx);
  }

  async start(): Promise<void> {
    await this.startListener();
    
    await this.performBackfill();

    this.subscriptionId = this.connection.onProgramAccountChange(
      this.getProgramId(),
      async (accountInfo, _context) => {
        if (!this.isRunning) return;
        
        // ВРЕМЕННО: ослабляем фильтр для тестирования
        // Проверяем только что аккаунт принадлежит программе Raydium
        if (accountInfo.accountInfo.owner.toString() !== this.getProgramId().toString()) {
          return;
        }
        
        // Фильтруем только аккаунты пулов Raydium (размер данных 752 или 2208 байт)
        if (accountInfo.accountInfo.data.length !== 752 && accountInfo.accountInfo.data.length !== 2208) {
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
          dataLength: accountInfo.accountInfo.data.length,
          accountId: accountInfo.accountId.toString(),
          owner: accountInfo.accountInfo.owner.toString()
        }, 'New pool account detected');
        
        try {
          const tx = await this.bot.addToQueue(async () => {
            const signatures = await this.connection.getSignaturesForAddress(accountInfo.accountId, { limit: 1 });
            logger.debug({ 
              dex: this.getDexName(),
              accountId: accountInfo.accountId.toString(),
              signaturesFound: signatures.length,
              signature: signatures[0]?.signature || 'none'
            }, 'Found signatures for account');
            
            if (signatures.length === 0) return null;
            
            const parsedTx = await this.connection.getParsedTransaction(
              signatures[0]?.signature || '',
              { maxSupportedTransactionVersion: 0 }
            );
            
            logger.debug({ 
              dex: this.getDexName(),
              signature: signatures[0]?.signature || 'unknown',
              hasTransaction: !!parsedTx,
              hasInstructions: !!parsedTx?.transaction?.message?.instructions,
              instructionsCount: parsedTx?.transaction?.message?.instructions?.length || 0,
              hasInnerInstructions: !!parsedTx?.meta?.innerInstructions,
              innerInstructionsCount: parsedTx?.meta?.innerInstructions?.length || 0
            }, 'Retrieved parsed transaction');
            
            return parsedTx;
          });
          
          if (tx) {
            await this.processTransaction(tx);
          }
        } catch (error) {
          logger.debug({ error }, 'Failed to process Raydium transaction');
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
      return LIQUIDITY_STATE_LAYOUT_V4.decode(data);
    } catch (error) {
      logger.debug({ error }, 'Failed to decode Raydium pool state');
      throw error;
    }
  }
}