import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { MARKET_STATE_LAYOUT_V3 } from '@raydium-io/raydium-sdk';
import { DetectedPool, TradingPosition } from './core/types';
import { logger, logPoolProcessingStart, logPoolProcessingEnd } from './utils/logger';
import { config } from './utils/config';

import { RaydiumListener } from './listeners/raydium-listener';
import { MeteoraListener } from './listeners/meteora-listener';
import { PumpSwapListener } from './listeners/pumpswap-listener';
import { FilterManager } from './filters/filter-manager';
import { SimpleTrader } from './traders';
import { TraderConfigFactory } from './utils/trader-config-factory';
import { TransactionExecutorFactory } from './utils/transaction-executor-factory';
// import { PoolCache } from './cache/pool-cache';
import { MarketCache } from './cache/market-cache';

export class TradingBot {
  private connection!: Connection;
  private wallet!: Keypair;
  private raydiumListener!: RaydiumListener;
  private meteoraListener!: MeteoraListener;
  private pumpswapListener!: PumpSwapListener;
  private filterManager!: FilterManager;
  private trader!: SimpleTrader;
  // private poolCache = new PoolCache();
  private marketCache = new MarketCache();
  private positions = new Map<string, TradingPosition>();
  private rpcQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private shouldStopQueue = false;
  private isRunning = false;
  
  private activeTokens = new Set<string>();
  private tokenQueue: Array<{ pool: DetectedPool; resolve: () => void; reject: (error: Error) => void }> = [];

  constructor() {
  }


  private async addTokenToQueue(pool: DetectedPool): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tokenQueue.push({ pool, resolve, reject });
      this.processTokenQueue();
    });
  }

  private async processTokenQueue(): Promise<void> {
    if (this.activeTokens.size >= config.maxTokensAtTheTime) {
      logger.debug({
        activeTokens: this.activeTokens.size,
        maxTokens: config.maxTokensAtTheTime,
        queueLength: this.tokenQueue.length
      }, 'Token limit reached, queuing pool');
      return;
    }

    const nextToken = this.tokenQueue.shift();
    if (!nextToken) {
      return;
    }

    const { pool, resolve, reject } = nextToken;
    
    if (this.activeTokens.has(pool.baseMint)) {
      logger.debug({ token: pool.baseMint }, 'Token already being processed, skipping');
      resolve();
      return;
    }

    this.activeTokens.add(pool.baseMint);
    
    logger.debug({
      token: pool.baseMint,
      activeTokens: this.activeTokens.size,
      maxTokens: config.maxTokensAtTheTime
    }, 'Starting token processing');

    try {
      await this.processPoolInternal(pool);
      resolve();
    } catch (error) {
      reject(error as Error);
    } finally {
      this.activeTokens.delete(pool.baseMint);
      logger.debug({
        token: pool.baseMint,
        activeTokens: this.activeTokens.size
      }, 'Token processing completed');
      
      this.processTokenQueue();
    }
  }

  public async addToQueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.shouldStopQueue) {
      throw new Error('Bot is stopping, queue is closed');
    }
    
    return new Promise((resolve, reject) => {
      this.rpcQueue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.rpcQueue.length === 0 || this.shouldStopQueue) {
      return;
    }

    this.isProcessingQueue = true;
    
    while (this.rpcQueue.length > 0 && !this.shouldStopQueue) {
      const task = this.rpcQueue.shift();
      if (task) {
        await task();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    this.isProcessingQueue = false;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot already running');
      return;
    }

    logger.info('Trading bot starting...');

    try {
      // 1. Инициализация подключения к Solana
      this.connection = new Connection(config.rpcEndpoint, {
        commitment: 'confirmed',
        wsEndpoint: config.rpcWebsocketEndpoint
      });
      logger.info('Connected to Solana RPC');

      // 2. Инициализация кошелька
      const privateKeyBytes = Buffer.from(config.privateKey, 'base64');
      this.wallet = Keypair.fromSecretKey(privateKeyBytes);
      logger.info('Wallet initialized');

      // 3. Валидация кошелька
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      // if (balance === 0) {
      //   throw new Error('Wallet has zero balance');
      // }
      logger.info({ balance: balance / 1e9 }, 'Wallet validated');

      // 4. Создание менеджера фильтров
      this.filterManager = new FilterManager({
        connection: this.connection
      });

      // 5. Создание слушателей с очередью для rate limiting
      this.raydiumListener = new RaydiumListener(this.connection, this);
      this.meteoraListener = new MeteoraListener(this.connection, this);
      this.pumpswapListener = new PumpSwapListener(this.connection, this);
      
      // Подписываемся на события от всех слушателей
      this.raydiumListener.onPoolDetected((pool) => this.processPool(pool));
      this.meteoraListener.onPoolDetected((pool) => this.processPool(pool));
      this.pumpswapListener.onPoolDetected((pool) => this.processPool(pool));

      // 6. Создание transaction executor через фабрику
      const txExecutor = TransactionExecutorFactory.createTransactionExecutor(this.connection);
      
      // Создаем конфигурацию трейдера через фабрику
      const traderConfig = await TraderConfigFactory.createTraderConfig(config, this.wallet);
      this.trader = new SimpleTrader(this.connection, txExecutor, traderConfig, this.marketCache);

      // 7. Подписка на маркеты для кэширования
      this.subscribeToMarkets();

      // 8. Запуск всех слушателей
      await Promise.all([
        this.raydiumListener.start(),
        this.meteoraListener.start(),
        this.pumpswapListener.start(),
      ]);

      this.isRunning = true;
      logger.info('Bot is running! Press CTRL + C to stop.');

    } catch (error) {
      logger.error({ error }, 'Failed to start bot');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping bot...');
    
    try {
      // 1. Остановка всех слушателей
      await Promise.all([
        this.raydiumListener.stop(),
        this.meteoraListener.stop(),
        this.pumpswapListener.stop(),
      ]);
      
      // 3. Останавливаем очередь RPC запросов
      this.shouldStopQueue = true;
      
      // 4. Очищаем очередь токенов
      this.tokenQueue.forEach(({ reject }) => {
        reject(new Error('Bot is stopping, token queue is closed'));
      });
      this.tokenQueue = [];
      this.activeTokens.clear();
      
      // Ждем завершения всех RPC запросов в очереди
      const maxWaitTime = 5000; 
      const startTime = Date.now();
      
      while ((this.rpcQueue.length > 0 || this.isProcessingQueue) && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.rpcQueue.length > 0 || this.isProcessingQueue) {
        logger.warn('RPC queue did not empty within timeout, forcing shutdown');
      }
      
      this.isRunning = false;
      logger.info('Bot stopped.');
      
    } catch (error) {
      logger.error({ error }, 'Error stopping bot');
      throw error;
    }
  }

  private subscribeToMarkets(): void {
    this.connection.onProgramAccountChange(
      new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'), // OpenBook Market Program
      async (accountInfo) => {
        try {
          const marketState = MARKET_STATE_LAYOUT_V3.decode(accountInfo.accountInfo.data);
          
          this.marketCache.save(accountInfo.accountId.toString(), {
            eventQueue: marketState.eventQueue,
            bids: marketState.bids,
            asks: marketState.asks,
          });
          
          logger.trace({ marketId: accountInfo.accountId.toString() }, 'Market data cached');
        } catch (error) {
          logger.debug({ error, marketId: accountInfo.accountId.toString() }, 'Failed to decode market data');
        }
      },
      { commitment: 'confirmed' }
    );
  }

  private async processPool(pool: DetectedPool): Promise<void> {
    logger.debug({
      poolId: pool.poolId,
      baseMint: pool.baseMint,
      dex: pool.dex
    }, 'Processing new pool - initial data');
    
    await this.addTokenToQueue(pool);
  }

  private async processPoolInternal(pool: DetectedPool): Promise<void> {
    const startTime = Date.now();
    logPoolProcessingStart(pool.baseMint, pool.dex);
    
    await this.addToQueue(async () => {
      try {
        // 1. Проверяем фильтры 
        const { passed, results } = await this.filterManager.checkPoolConsecutive(pool);
        
        if (!passed) {
          const failedFilters = results ? 
            Object.entries(results)
              .filter(([_, result]) => result && !result.ok)
              .map(([name, _]) => name) : [];
          
          logger.debug({
            pool: pool.baseMint,
            failedFilters
          }, 'Pool filtered out');
          return;
        }

        // 2. Выполняем покупку через SimpleTrader
        logger.debug({
          poolId: pool.poolId,
          baseMint: pool.baseMint
        }, 'Calling executeBuy - trader will fetch pool state itself');
        
        const buyResult = await this.trader.executeBuy(pool);
        
        if (buyResult.success) {
          logger.info({ 
            pool: pool.baseMint, 
            tx: buyResult.txId,
            price: buyResult.price,
            amount: buyResult.amount
          }, 'Buy order executed');
          
          // 3. Добавляем позицию для мониторинга
          this.positions.set(pool.poolId, {
            pool,
            buyTxId: buyResult.txId!,
            buyPrice: buyResult.price!,
            amount: buyResult.amount!,
            timestamp: Date.now(),
          });
        } else {
          logger.error({ pool: pool.baseMint, error: buyResult.error }, 'Buy order failed');
        }
        
      } catch (error) {
        logger.error({ error, pool: pool.baseMint }, 'Pool processing failed');
      } finally {
        const duration = Date.now() - startTime;
        logPoolProcessingEnd(pool.baseMint, pool.dex, duration);
      }
    });
  }
}

