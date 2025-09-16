import { Keypair } from '@solana/web3.js';
import { Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { BotConfig } from '../core/types';
import { SimpleTraderConfig } from '../traders/simple-trader';

export class TraderConfigFactory {
  static async createTraderConfig(
    config: BotConfig,
    wallet: Keypair
  ): Promise<SimpleTraderConfig> {
    const quoteToken = Token.WSOL;
    const quoteAmount = new TokenAmount(quoteToken, config.buyAmount, false);
    const quoteAta = await getAssociatedTokenAddress(quoteToken.mint, wallet.publicKey);
    
    return {
      // Wallet
      wallet,
      
      // Pool size limits
      minPoolSize: new TokenAmount(quoteToken, config.minPoolSize, false),
      maxPoolSize: new TokenAmount(quoteToken, config.maxPoolSize, false),
      
      // Quote token configuration
      quoteToken,
      quoteAmount,
      quoteAta,
      
      // Trading limits
      maxTokensAtTheTime: config.maxTokensAtTheTime,
      
      // Auto trading settings
      autoSell: config.autoSell,
      autoBuyDelay: config.autoBuyDelay,
      autoSellDelay: config.autoSellDelay,
      
      // Retry settings
      maxBuyRetries: config.maxBuyRetries,
      maxSellRetries: config.maxSellRetries,
      
      // Unit limits
      unitLimit: config.unitLimit,
      unitPrice: config.unitPrice,
      
      // Profit/Loss settings
      takeProfit: config.takeProfit,
      stopLoss: config.stopLoss,
      trailingStopLoss: config.trailingStopLoss,
      skipSellingIfLostMoreThan: config.skipSellingIfLostMoreThan,
      
      // Slippage settings
      buySlippage: config.buySlippageBps / 100,
      sellSlippage: config.sellSlippageBps / 100,
      
      // Price checking
      priceCheckInterval: config.priceCheckInterval,
      priceCheckDuration: config.priceCheckDuration,
      
      // Filter settings
      filterCheckInterval: config.filterCheckInterval,
      filterCheckDuration: config.filterCheckDuration,
      consecutiveMatchCount: config.consecutiveFilterMatches,
    };
  }
}
