import { LiquidityStateV4 } from '@raydium-io/raydium-sdk';

export class PoolCache {
  private pools = new Map<string, { id: string; state: LiquidityStateV4 }>();

  save(id: string, state: LiquidityStateV4): void {
    this.pools.set(id, { id, state });
  }

  get(id: string): { id: string; state: LiquidityStateV4 } | undefined {
    return this.pools.get(id);
  }

  clear(): void {
    this.pools.clear();
  }

  size(): number {
    return this.pools.size;
  }
}
