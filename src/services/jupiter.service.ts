import { Connection } from '@solana/web3.js';
import { JupiterQuoteRequest, JupiterQuoteResponse } from '../core/types';
import { logger } from '../utils/logger';

export class JupiterService {
  // private connection: Connection; // Не используется в текущей реализации
  private baseUrl: string;
  private cache = new Map<string, { data: JupiterQuoteResponse; timestamp: number }>();

  constructor(_connection: Connection) {
    // this.connection = _connection; // Не используется в текущей реализации
    this.baseUrl = 'https://quote-api.jup.ag';
  }

  async getQuote(request: JupiterQuoteRequest): Promise<JupiterQuoteResponse | null> {
    const cacheKey = `${request.inputMint}-${request.outputMint}-${request.amount}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 7000) { // 7 секунд TTL
      return cached.data;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v6/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...request,
          maxAccounts: 4,
        }),
      });

      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.status}`);
      }

      const data = await response.json();
      const quote = data as JupiterQuoteResponse;
      this.cache.set(cacheKey, { data: quote, timestamp: Date.now() });
      return quote;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          request,
        },
        'Jupiter API error',
      );
      logger.error({ error, request }, 'Failed to get Jupiter quote');
      return null;
    }
  }

  async isRouteAvailable(inputMint: string, outputMint: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=1000000&slippageBps=50`,
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return data && data.outAmount;
    } catch (error) {
      logger.error({ error }, 'Failed to check Jupiter route');
      return false;
    }
  }

  async checkRoute(inputMint: string, outputMint: string, amount: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.debug({
          inputMint,
          outputMint,
          amount,
          status: response.status,
          error: errorText
        }, 'Jupiter route check failed - HTTP error');
        return false;
      }

      const data = await response.json();
      
      // Проверяем, есть ли ошибка в ответе
      if (data.error) {
        logger.debug({
          inputMint,
          outputMint,
          amount,
          error: data.error,
          errorCode: data.errorCode
        }, 'Jupiter route check failed - API error');
        return false;
      }
      
      return data && data.outAmount;
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        inputMint,
        outputMint,
        amount
      }, 'Failed to check Jupiter route');
      return false;
    }
  }

  async getRouteInfo(inputMint: string, outputMint: string, amount: string): Promise<any> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`,
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.error({ error }, 'Failed to get Jupiter route info');
      return null;
    }
  }

  async getSwapTransaction(
    inputMint: string,
    outputMint: string,
    amount: string,
    userPublicKey: string,
    slippageBps: number = 50,
  ): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/v6/swap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: {
            inputMint,
            inAmount: amount,
            outputMint,
            outAmount: '0',
            otherAmountThreshold: '0',
            swapMode: 'ExactIn',
            slippageBps,
            platformFee: null,
            priceImpactPct: '0',
          },
          userPublicKey,
          wrapAndUnwrapSol: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Jupiter swap error: ${response.status}`);
      }

      const swapResponse = await response.json();
      if (!swapResponse.swapTransaction) {
        logger.error({ response: swapResponse }, 'Invalid swap response from Jupiter');
        return null;
      }

      return swapResponse;
    } catch (error) {
      logger.error({ error, inputMint, outputMint, amount }, 'Failed to get Jupiter swap transaction');
      return null;
    }
  }

  // private cleanupCache(): void {
  //   const now = Date.now();
  //   for (const [key, value] of this.cache.entries()) {
  //     if (now - value.timestamp > config.jupiterTtlMs) {
  //       this.cache.delete(key);
  //     }
  //   }
  // }
}
