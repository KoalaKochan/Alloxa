import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Liquidity, LiquidityPoolKeysV4, Percent, Token, TokenAmount, MARKET_STATE_LAYOUT_V3 } from '@raydium-io/raydium-sdk';
import { DetectedPool, TradingPosition } from '../core/types';
import { logger } from '../utils/logger';
import { TransactionExecutor } from './transaction-executor.interface';
import { createPoolKeys, MinimalMarketLayoutV3 } from './raydium-liquidity-helper';
// import { LIQUIDITY_STATE_LAYOUT_V4 } from '@raydium-io/raydium-sdk';
import { MarketCache } from '../cache/market-cache';
import BN from 'bn.js';

export interface SimpleTraderConfig {
  wallet: Keypair;
  minPoolSize: TokenAmount;
  maxPoolSize: TokenAmount;
  quoteToken: Token;
  quoteAmount: TokenAmount;
  quoteAta: PublicKey;
  maxTokensAtTheTime: number;
  autoSell: boolean;
  autoBuyDelay: number;
  autoSellDelay: number;
  maxBuyRetries: number;
  maxSellRetries: number;
  unitLimit: number;
  unitPrice: number;
  takeProfit: number;
  stopLoss: number;
  trailingStopLoss: boolean;
  skipSellingIfLostMoreThan: number;
  buySlippage: number;
  sellSlippage: number;
  priceCheckInterval: number;
  priceCheckDuration: number;
  filterCheckInterval: number;
  filterCheckDuration: number;
  consecutiveMatchCount: number;
}

export interface TradingResult {
  success: boolean;
  txId?: string | undefined;
  price?: number | undefined;
  amount?: number | undefined;
  error?: string | undefined;
}

export class SimpleTrader {
  private readonly stopLoss = new Map<string, TokenAmount>();
  private readonly isWarp: boolean = false;
  private readonly isJito: boolean = false;

  constructor(
    private readonly connection: Connection,
    private readonly txExecutor: TransactionExecutor,
    private readonly config: SimpleTraderConfig,
    private readonly marketCache: MarketCache,
  ) {
    this.isWarp = txExecutor.constructor.name === 'WarpTransactionExecutor';
    this.isJito = txExecutor.constructor.name === 'JitoTransactionExecutor';
  }

  async executeBuy(pool: DetectedPool, poolState?: any): Promise<TradingResult> {
    logger.debug({ 
      mint: pool.baseMint,
      poolId: pool.poolId,
      hasPoolState: !!poolState,
      poolStateKeys: poolState ? Object.keys(poolState) : null
    }, 'SimpleTrader.executeBuy - starting');

    // Если poolState не передан, получаем его из аккаунта пула
    if (!poolState) {
      logger.debug({ mint: pool.baseMint, poolId: pool.poolId, dex: pool.dex }, 'PoolState not provided, fetching from account');
      try {
        poolState = await this.getPoolStateFromAccount(pool);
      } catch (error) {
        logger.error({ 
          mint: pool.baseMint, 
          poolId: pool.poolId, 
          dex: pool.dex,
          error: error instanceof Error ? error.message : 'Unknown error' 
        }, 'Failed to get pool state from account');
        return {
          success: false,
          error: 'Failed to get pool state from account',
        };
      }
    }

    if (this.config.autoBuyDelay > 0) {
      logger.debug({ mint: pool.baseMint }, `Waiting for ${this.config.autoBuyDelay} ms before buy`);
      await this.delay(this.config.autoBuyDelay);
    }

    try {
      // Логируем детали poolState
      logger.debug({
        mint: pool.baseMint,
        poolState: {
          baseMint: poolState?.baseMint?.toString(),
          quoteMint: poolState?.quoteMint?.toString(),
          marketId: poolState?.marketId?.toString(),
          quoteReserve: poolState?.quoteReserve?.toString(),
          baseReserve: poolState?.baseReserve?.toString(),
          baseDecimal: poolState?.baseDecimal?.toString(),
          quoteDecimal: poolState?.quoteDecimal?.toString(),
          lpMint: poolState?.lpMint?.toString(),
          openOrders: poolState?.openOrders?.toString(),
          targetOrders: poolState?.targetOrders?.toString(),
          baseVault: poolState?.baseVault?.toString(),
          quoteVault: poolState?.quoteVault?.toString(),
          marketProgramId: poolState?.marketProgramId?.toString()
        }
      }, 'Pool state details for buy execution');

      // Проверяем размер пула
      // poolState.baseReserve в нативных единицах base токена, но мы сравниваем с quote токеном
      // Нужно использовать quoteReserve для корректного сравнения
      if (!poolState?.quoteReserve) {
        logger.error({
          mint: pool.baseMint,
          poolState: poolState
        }, 'Missing quoteReserve in poolState');
        return {
          success: false,
          error: 'Missing quoteReserve in poolState',
        };
      }

      const quoteReserveAmount = new TokenAmount(this.config.quoteToken, poolState.quoteReserve);
      logger.debug({
        mint: pool.baseMint,
        quoteReserve: quoteReserveAmount.toFixed(),
        minPoolSize: this.config.minPoolSize.toFixed(),
        maxPoolSize: this.config.maxPoolSize.toFixed(),
        isLtMin: quoteReserveAmount.lt(this.config.minPoolSize),
        isGtMax: quoteReserveAmount.gt(this.config.maxPoolSize)
      }, 'Pool size validation');

      if (quoteReserveAmount.lt(this.config.minPoolSize) || quoteReserveAmount.gt(this.config.maxPoolSize)) {
        logger.warn(
          {
            mint: pool.baseMint,
            quoteReserve: quoteReserveAmount.toFixed(),
            minPoolSize: this.config.minPoolSize.toFixed(),
            maxPoolSize: this.config.maxPoolSize.toFixed(),
          },
          'Pool size is outside the allowed range',
        );
        return {
          success: false,
          error: 'Pool size is outside the allowed range',
        };
      }

      logger.debug({
        mint: pool.baseMint,
        baseMint: poolState.baseMint?.toString(),
        marketId: poolState.marketId?.toString()
      }, 'Getting mint ATA and market data');

      const mintAta = await getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey);
      
      logger.debug({
        mint: pool.baseMint,
        mintAta: mintAta.toString(),
        marketId: poolState.marketId?.toString()
      }, 'Got mint ATA, fetching market data');

      const market = await this.getMarketData(poolState.marketId.toString());
      
      logger.debug({
        mint: pool.baseMint,
        market: {
          eventQueue: market.eventQueue.toString(),
          bids: market.bids.toString(),
          asks: market.asks.toString()
        }
      }, 'Got market data, creating pool keys');

      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(
        new PublicKey(pool.poolId),
        poolState,
        market,
      );

      logger.debug({
        mint: pool.baseMint,
        poolKeys: {
          id: poolKeys.id.toString(),
          baseMint: poolKeys.baseMint.toString(),
          quoteMint: poolKeys.quoteMint.toString(),
          lpMint: poolKeys.lpMint.toString(),
          baseVault: poolKeys.baseVault.toString(),
          quoteVault: poolKeys.quoteVault.toString(),
          marketId: poolKeys.marketId.toString()
        }
      }, 'Created pool keys, starting swap attempts');

      for (let i = 0; i < this.config.maxBuyRetries; i++) {
        try {
          logger.info(
            { mint: poolState.baseMint.toString() },
            `Send buy transaction attempt: ${i + 1}/${this.config.maxBuyRetries}`,
          );

          const tokenOut = new Token(TOKEN_PROGRAM_ID, poolKeys.baseMint, poolKeys.baseDecimals);
          const result = await this.swap(
            poolKeys,
            this.config.quoteAta,
            mintAta,
            this.config.quoteToken,
            tokenOut,
            this.config.quoteAmount,
            this.config.buySlippage,
            this.config.wallet,
            'buy',
          );

          if (result.confirmed) {
            logger.info(
              {
                mint: poolState.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}`,
              },
              `Confirmed buy tx`,
            );

            return {
              success: true,
              txId: result.signature || '',
              amount: this.config.quoteAmount.raw.toNumber(),
            };
          }

          logger.info(
            {
              mint: poolState.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming buy tx`,
          );
        } catch (error) {
          logger.debug({ mint: poolState.baseMint.toString(), error }, `Error confirming buy transaction`);
        }
      }

      return {
        success: false,
        error: 'All buy attempts failed',
      };
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined,
        mint: pool.baseMint,
        poolId: pool.poolId,
        hasPoolState: !!poolState,
        poolStateKeys: poolState ? Object.keys(poolState) : null
      }, `Failed to buy token`);
      return {
        success: false,
        error: this.formatError(error),
      };
    }
  }

  async executeSell(position: TradingPosition, poolState: any): Promise<TradingResult> {
    try {
      logger.trace({ mint: position.pool.baseMint }, `Processing sell for token...`);

      if (this.config.autoSellDelay > 0) {
        logger.debug({ mint: position.pool.baseMint }, `Waiting for ${this.config.autoSellDelay} ms before sell`);
        await this.delay(this.config.autoSellDelay);
      }

      const market = await this.getMarketData(poolState.marketId.toString());
      const poolKeys: LiquidityPoolKeysV4 = createPoolKeys(
        new PublicKey(position.pool.poolId),
        poolState,
        market,
      );

      const tokenIn = new Token(TOKEN_PROGRAM_ID, poolState.baseMint, poolState.baseDecimal.toNumber());
      const tokenAmountIn = new TokenAmount(tokenIn, position.amount, true);

      if (tokenAmountIn.isZero()) {
        logger.info({ mint: position.pool.baseMint }, `Empty balance, can't sell`);
        return {
          success: false,
          error: 'Empty balance',
        };
      }

      for (let i = 0; i < this.config.maxSellRetries; i++) {
        try {
          const shouldSell = await this.waitForSellSignal(tokenAmountIn, poolKeys);

          if (!shouldSell) {
            return {
              success: false,
              error: 'Sell signal not triggered',
            };
          }

          logger.info(
            { mint: position.pool.baseMint },
            `Send sell transaction attempt: ${i + 1}/${this.config.maxSellRetries}`,
          );

          const tokenAccount = await getAssociatedTokenAddress(poolState.baseMint, this.config.wallet.publicKey);
          const result = await this.swap(
            poolKeys,
            tokenAccount,
            this.config.quoteAta,
            tokenIn,
            this.config.quoteToken,
            tokenAmountIn,
            this.config.sellSlippage,
            this.config.wallet,
            'sell',
          );

          if (result.confirmed) {
            logger.info(
              {
                dex: `https://dexscreener.com/solana/${position.pool.baseMint}?maker=${this.config.wallet.publicKey}`,
                mint: position.pool.baseMint.toString(),
                signature: result.signature,
                url: `https://solscan.io/tx/${result.signature}`,
              },
              `Confirmed sell tx`,
            );

            return {
              success: true,
              txId: result.signature || '',
            };
          }

          logger.info(
            {
              mint: position.pool.baseMint.toString(),
              signature: result.signature,
              error: result.error,
            },
            `Error confirming sell tx`,
          );
        } catch (error) {
          logger.debug({ mint: position.pool.baseMint.toString(), error }, `Error confirming sell transaction`);
        }
      }

      return {
        success: false,
        error: 'All sell attempts failed',
      };
    } catch (error) {
      logger.error({ mint: position.pool.baseMint, error }, `Failed to sell token`);
      return {
        success: false,
        error: this.formatError(error),
      };
    }
  }

  private async swap(
    poolKeys: LiquidityPoolKeysV4,
    ataIn: PublicKey,
    ataOut: PublicKey,
    _tokenIn: Token,
    tokenOut: Token,
    amountIn: TokenAmount,
    slippage: number,
    wallet: Keypair,
    direction: 'buy' | 'sell',
  ) {
    const slippagePercent = new Percent(slippage, 100);
    const poolInfo = await Liquidity.fetchInfo({
      connection: this.connection,
      poolKeys,
    });

    const computedAmountOut = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: tokenOut,
      slippage: slippagePercent,
    });

    const latestBlockhash = await this.connection.getLatestBlockhash();
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: poolKeys,
        userKeys: {
          tokenAccountIn: ataIn,
          tokenAccountOut: ataOut,
          owner: wallet.publicKey,
        },
        amountIn: amountIn.raw,
        minAmountOut: computedAmountOut.minAmountOut.raw,
      },
      poolKeys.version,
    );

    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ...(this.isWarp || this.isJito
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.config.unitPrice }),
              ComputeBudgetProgram.setComputeUnitLimit({ units: this.config.unitLimit }),
            ]),
        ...(direction === 'buy'
          ? [
              createAssociatedTokenAccountIdempotentInstruction(
                wallet.publicKey,
                ataOut,
                wallet.publicKey,
                tokenOut.mint,
              ),
            ]
          : []),
        ...innerTransaction.instructions,
        ...(direction === 'sell' ? [createCloseAccountInstruction(ataIn, wallet.publicKey, wallet.publicKey)] : []),
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);

    return this.txExecutor.executeAndConfirm(transaction, wallet, latestBlockhash);
  }

  private async waitForSellSignal(amountIn: TokenAmount, poolKeys: LiquidityPoolKeysV4) {
    if (this.config.priceCheckDuration === 0 || this.config.priceCheckInterval === 0) {
      return true;
    }

    const timesToCheck = this.config.priceCheckDuration / this.config.priceCheckInterval;
    const profitRatio = this.config.quoteAmount.mul(this.config.takeProfit).numerator.div(new BN(100));
    const profitAmount = new TokenAmount(this.config.quoteToken, profitRatio, true);
    const takeProfit = this.config.quoteAmount.add(profitAmount);
    let stopLoss: TokenAmount;

    if (!this.stopLoss.get(poolKeys.baseMint.toString())) {
      const lossRatio = this.config.quoteAmount.mul(this.config.stopLoss).numerator.div(new BN(100));
      const lossAmount = new TokenAmount(this.config.quoteToken, lossRatio, true);
      stopLoss = this.config.quoteAmount.subtract(lossAmount);
      this.stopLoss.set(poolKeys.baseMint.toString(), stopLoss);
    } else {
      stopLoss = this.stopLoss.get(poolKeys.baseMint.toString())!;
    }

    const slippage = new Percent(this.config.sellSlippage, 100);
    let timesChecked = 0;

    do {
      try {
        const poolInfo = await Liquidity.fetchInfo({
          connection: this.connection,
          poolKeys,
        });

        const computedAmountOut = Liquidity.computeAmountOut({
          poolKeys,
          poolInfo,
          amountIn,
          currencyOut: this.config.quoteToken,
          slippage,
        });

        if (this.config.trailingStopLoss) {
          const trailingLossRatio = amountIn.mul(this.config.stopLoss).numerator.div(new BN(100));
          const trailingLossAmount = new TokenAmount(this.config.quoteToken, trailingLossRatio, true);
          const trailingStopLoss = amountIn.subtract(trailingLossAmount);

          if (computedAmountOut.amountOut.lt(trailingStopLoss)) {
            this.stopLoss.set(poolKeys.baseMint.toString(), trailingStopLoss);
          }
        }

        if (computedAmountOut.amountOut.lt(stopLoss)) {
          logger.info(
            {
              mint: poolKeys.baseMint.toString(),
              amountOut: computedAmountOut.amountOut.toFixed(),
              stopLoss: stopLoss.toFixed(),
            },
            `Stop loss triggered`,
          );
          break;
        }

        if (computedAmountOut.amountOut.gt(takeProfit)) {
          this.stopLoss.delete(poolKeys.baseMint.toString());
          break;
        }

        if (this.config.skipSellingIfLostMoreThan > 0) {
          const stopSellingRatio = this.config.quoteAmount
            .mul(this.config.skipSellingIfLostMoreThan)
            .numerator.div(new BN(100));
          const stopSellingAmount = new TokenAmount(this.config.quoteToken, stopSellingRatio, true);

          if (computedAmountOut.amountOut.lt(stopSellingAmount)) {
            logger.info(
              {
                mint: poolKeys.baseMint.toString(),
                amountOut: computedAmountOut.amountOut.toFixed(),
                stopSellingAmount: stopSellingAmount.toFixed(),
              },
              `Token dropped more than ${this.config.skipSellingIfLostMoreThan}%, sell stopped. Initial: ${this.config.quoteAmount.toFixed()} | Current: ${computedAmountOut.amountOut.toFixed()}`,
            );
            return false;
          }
        }

        await this.delay(this.config.priceCheckInterval);
      } catch (e) {
        logger.trace({ mint: poolKeys.baseMint.toString(), e }, `Failed to check token price`);
      } finally {
        timesChecked++;
      }
    } while (timesChecked < timesToCheck);

    return true;
  }


  private async getPoolStateFromAccount(pool?: DetectedPool): Promise<any> {
    // Пока что все DEX используют fallback данные
    // В будущем здесь можно добавить специфичное декодирование для каждого DEX
    return await this.getFallbackPoolState(pool);
  }

  private async getFallbackPoolState(pool?: DetectedPool): Promise<any> {
    if (!pool) {
      throw new Error('Pool information is required for fallback pool state');
    }

    // Используем реальные данные из DetectedPool
    const baseMint = new PublicKey(pool.baseMint);
    const quoteMint = new PublicKey(pool.quoteMint);
    const lpMint = pool.lpMint ? new PublicKey(pool.lpMint) : new PublicKey('11111111111111111111111111111111');
    
    // Получаем decimals токенов
    let baseDecimal = new BN(9);
    let quoteDecimal = new BN(9);
    
    try {
      const [baseTokenInfo, quoteTokenInfo] = await Promise.all([
        this.connection.getParsedAccountInfo(baseMint),
        this.connection.getParsedAccountInfo(quoteMint)
      ]);
      
      if (baseTokenInfo.value?.data && 'parsed' in baseTokenInfo.value.data) {
        baseDecimal = new BN(baseTokenInfo.value.data.parsed.info.decimals);
      }
      
      if (quoteTokenInfo.value?.data && 'parsed' in quoteTokenInfo.value.data) {
        quoteDecimal = new BN(quoteTokenInfo.value.data.parsed.info.decimals);
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to get token decimals, using defaults');
    }
    
    // Создаем минимальную структуру poolState с реальными данными
    return {
      baseMint,
      quoteMint,
      marketId: new PublicKey('11111111111111111111111111111111'), // Mock - не используется для PumpSwap/Meteora
      quoteReserve: new BN(1000000), // Mock - будет перезаписан при реальном декодировании
      baseReserve: new BN(1000000),
      baseDecimal,
      quoteDecimal,
      lpMint,
      openOrders: new PublicKey('11111111111111111111111111111111'), // Mock - не используется
      targetOrders: new PublicKey('11111111111111111111111111111111'), // Mock - не используется
      baseVault: new PublicKey('11111111111111111111111111111111'), // Mock - не используется
      quoteVault: new PublicKey('11111111111111111111111111111111'), // Mock - не используется
      marketProgramId: new PublicKey('11111111111111111111111111111111') // Mock - не используется
    };
  }

  private async getMarketData(marketId: string): Promise<MinimalMarketLayoutV3> {
    logger.debug({ marketId }, 'Getting market data');
    
    // 1. Сначала проверяем кэш
    const cached = this.marketCache.get(marketId);
    if (cached) {
      logger.debug({ marketId }, 'Market data found in cache');
      return cached;
    }

    logger.debug({ marketId }, 'Market data not in cache, fetching from RPC');

    // 2. Если нет в кэше - запрашиваем RPC
    try {
      const marketInfo = await this.connection.getAccountInfo(new PublicKey(marketId), {
        commitment: this.connection.commitment || 'confirmed',
        dataSlice: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf('eventQueue'),
          length: 32 * 3,
        },
      });

      if (!marketInfo) {
        logger.error({ marketId }, 'Market not found on-chain');
        throw new Error('Market not found');
      }

      logger.debug({ 
        marketId, 
        dataLength: marketInfo.data.length,
        owner: marketInfo.owner.toString()
      }, 'Got market account info from RPC');

      // Декодируем минимальные данные маркета
      const eventQueueOffset = 0;
      const bidsOffset = 32;
      const asksOffset = 64;

      const marketData: MinimalMarketLayoutV3 = {
        eventQueue: new PublicKey(marketInfo.data.slice(eventQueueOffset, eventQueueOffset + 32)),
        bids: new PublicKey(marketInfo.data.slice(bidsOffset, bidsOffset + 32)),
        asks: new PublicKey(marketInfo.data.slice(asksOffset, asksOffset + 32)),
      };

      // 3. Сохраняем в кэш
      this.marketCache.save(marketId, marketData);
      logger.trace({ marketId }, 'Market data cached');

      return marketData;
    } catch (error) {
      logger.warn({ marketId, error }, 'Failed to get market data, using defaults');
      return {
        bids: PublicKey.default,
        asks: PublicKey.default,
        eventQueue: PublicKey.default,
      };
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
