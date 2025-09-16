import { MinimalMarketLayoutV3 } from '../traders/raydium-liquidity-helper';

export class MarketCache {
  private markets = new Map<string, MinimalMarketLayoutV3>();

  save(id: string, market: MinimalMarketLayoutV3): void {
    this.markets.set(id, market);
  }

  get(id: string): MinimalMarketLayoutV3 | undefined {
    return this.markets.get(id);
  }

  clear(): void {
    this.markets.clear();
  }
}
