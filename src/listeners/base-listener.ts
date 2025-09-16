import { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js';
import { Token } from '@raydium-io/raydium-sdk';
import { DetectedPool } from '../core/types';
import { logger, logListenerReady, logPoolDetected } from '../utils/logger';
import { config } from '../utils/config';

export abstract class BaseListener {
  protected connection: Connection;
  protected bot: any;
  protected isRunning = false;
  protected backfillSlots = config.backfillSlots; // Количество слотов для backfill
  protected deduplicationTtl = 180000; // 3 минуты TTL для дедупликации
  protected seenPools = new Map<string, number>(); // poolId -> timestamp
  protected debounceTimers = new Map<string, NodeJS.Timeout>(); // poolId -> timer
  protected debounceDelay = 1000; // 1 секунда debounce
  protected cleanupInterval: NodeJS.Timeout | undefined;

  constructor(connection: Connection, bot: any) {
    this.connection = connection;
    this.bot = bot;
  }

  abstract getDexName(): string;
  abstract getProgramId(): PublicKey;
  abstract decodePoolsFromTx(tx: ParsedTransactionWithMeta): DetectedPool[];
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  
  // Backfill последних слотов при старте
  protected async performBackfill(): Promise<void> {
    try {
      logger.info({ 
        dex: this.getDexName(),
        backfillSlots: config.backfillSlots 
      }, 'Starting backfill');
      
      const latestSlot = await this.connection.getSlot();
      const startSlot = Math.max(0, latestSlot - config.backfillSlots);
      
      logger.debug({ 
        dex: this.getDexName(),
        latestSlot,
        startSlot,
        slotsToProcess: latestSlot - startSlot
      }, 'Backfill slot range');
      
      const signatures = await this.connection.getSignaturesForAddress(
        this.getProgramId(),
        { 
          limit: 1000
        }
      );
      
      const recentSignatures = signatures.filter(sig => 
        sig.slot >= startSlot && sig.slot <= latestSlot
      );
      
      logger.debug({ 
        dex: this.getDexName(),
        totalSignatures: signatures.length,
        recentSignatures: recentSignatures.length
      }, 'Backfill signatures filtered');
      
      const batchSize = 3; 
      let processedCount = 0;
      
      for (let i = 0; i < recentSignatures.length; i += batchSize) {
        const batch = recentSignatures.slice(i, i + batchSize);
        
        const txs = [];
        for (const sig of batch) {
          try {
            const tx = await this.connection.getTransaction(sig.signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            });
            txs.push(tx);
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            logger.debug({ 
              dex: this.getDexName(),
              signature: sig.signature,
              error: error instanceof Error ? error.message : 'Unknown error'
            }, 'Failed to get transaction during backfill');
            txs.push(null);
          }
        }
        
        for (const tx of txs) {
          if (tx && tx.meta) {
            await this.processTransaction(tx as any);
            processedCount++;
          }
        }
        
        if (i + batchSize < recentSignatures.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Увеличили с 100ms до 1000ms
        }
      }
      
      logger.info({ 
        dex: this.getDexName(),
        processedCount,
        totalSignatures: recentSignatures.length
      }, 'Backfill completed');
      
    } catch (error) {
      logger.error({ 
        dex: this.getDexName(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Backfill failed');
    }
  }

  protected onPoolDetectedCallback?: (pool: DetectedPool, poolState?: any) => void;

  onPoolDetected(callback: (pool: DetectedPool, poolState?: any) => void) {
    this.onPoolDetectedCallback = callback;
  }

  protected emitPoolDetected(pool: DetectedPool, poolState?: any) {
    if (this.onPoolDetectedCallback) {
      this.onPoolDetectedCallback(pool, poolState);
    }
  }

  protected async getPoolState(poolId: string): Promise<any> {
    const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolId));
    if (!accountInfo) {
      throw new Error('Pool account not found');
    }

    return this.decodePoolState(accountInfo.data);
  }

  protected abstract decodePoolState(data: Buffer): any;

  // Дедупликация пулов
  protected isDuplicatePool(poolId: string): boolean {
    const now = Date.now();
    const lastSeen = this.seenPools.get(poolId);
    
    if (lastSeen && now - lastSeen < this.deduplicationTtl) {
      return true;
    }
    
    this.seenPools.set(poolId, now);
    return false;
  }

  protected debouncePoolDetection(pool: DetectedPool) {
    const poolId = pool.poolId;
    
    const existingTimer = this.debounceTimers.get(poolId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const timer = setTimeout(() => {
      this.debounceTimers.delete(poolId);
      this.emitPoolDetected(pool);
    }, this.debounceDelay);
    
    this.debounceTimers.set(poolId, timer);
  }

  protected cleanupDeduplication() {
    const now = Date.now();
    
    // Очищаем старые записи дедупликации
    for (const [poolId, timestamp] of this.seenPools.entries()) {
      if (now - timestamp > this.deduplicationTtl) {
        this.seenPools.delete(poolId);
      }
    }
    
    // Очищаем истекшие debounce таймеры
    for (const [poolId, timer] of this.debounceTimers.entries()) {
      clearTimeout(timer);
      this.debounceTimers.delete(poolId);
    }
  }



  protected async processTransaction(tx: any) {
    try {
      const signature = tx.transaction.signatures[0];
      
      if (!signature) {
        logger.debug({ 
          dex: this.getDexName()
        }, 'No signature found, skipping');
        return;
      }
      
      const signatureStr = signature as string;
      
      logger.debug({ 
        dex: this.getDexName(),
        signature: signatureStr,
        instructionsCount: tx.transaction.message.instructions?.length || 0,
        innerInstructionsCount: tx.meta?.innerInstructions?.length || 0
      }, 'Processing transaction');
      
      // Проверка дедупликации
      if (this.seenPools.has(signatureStr)) {
        const timestamp = this.seenPools.get(signatureStr)!;
        if (Date.now() - timestamp < this.deduplicationTtl) {
          logger.debug({ 
            dex: this.getDexName(), 
            signature: signatureStr
          }, 'Duplicate transaction, skipping');
          return;
        }
      }
      
      // Записываем в кэш дедупликации
      this.seenPools.set(signatureStr, Date.now());
      
      const pools = this.decodePoolsFromTx(tx);
      
      logger.debug({ 
        dex: this.getDexName(),
        signature: signatureStr,
        poolsFound: pools.length
      }, 'Decoded pools from transaction');
      
      // Обрабатываем найденные пулы
      for (const pool of pools) {
        logger.debug({ 
          dex: this.getDexName(),
          poolId: pool.poolId,
          baseMint: pool.baseMint,
          quoteMint: pool.quoteMint
        }, 'Processing detected pool');
        
       
        // Проверяем, что это SOL пара (WSOL)
        if (pool.quoteMint !== Token.WSOL.mint.toString()) {
          logger.debug({ 
            dex: this.getDexName(),
            poolId: pool.poolId,
            quoteMint: pool.quoteMint,
            expected: Token.WSOL.mint.toString()
          }, 'Pool is not a SOL pair, skipping');
          continue;
        }

        // Дедупликация
        if (this.isDuplicatePool(pool.poolId)) {
          logger.debug({ 
            dex: this.getDexName(),
            poolId: pool.poolId
          }, 'Pool is duplicate, skipping');
          continue;
        }

        logPoolDetected(pool.dex, pool.baseMint, pool.quoteMint, pool.poolId);

        let poolState: any = null;
        try {
          poolState = await this.getPoolState(pool.poolId);
        } catch (error) {
          logger.debug({ 
            dex: this.getDexName(),
            poolId: pool.poolId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Failed to get pool state');
        }

        this.emitPoolDetected(pool, poolState);

        this.debouncePoolDetection(pool);
      }
    } catch (error) {
      logger.debug({ dex: this.getDexName(), error }, 'Failed to process transaction');
    }
  }

  protected async startListener() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    logListenerReady(this.getDexName(), 'account-change');

    this.cleanupInterval = setInterval(() => {
      this.cleanupDeduplication();
    }, 60000); 
  }

  protected async stopListener() {
    this.isRunning = false;
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    this.seenPools.clear();
  }
}
