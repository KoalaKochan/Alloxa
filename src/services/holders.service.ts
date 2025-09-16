import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../utils/logger';

export interface HolderInfo {
  address: string;
  amount: number;
  percentage: number;
}

export class HoldersService {
  private connection: Connection;
  private cache = new Map<string, { holders: HolderInfo[]; timestamp: number }>();
  private ttl = 300000; 

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async getHolders(mint: string, limit: number = 100): Promise<HolderInfo[]> {
    try {
      const cached = this.cache.get(mint);
      if (cached && Date.now() - cached.timestamp < this.ttl) {
        return cached.holders;
      }

      const holders = await this.fetchHolders(mint, limit);
      
      this.cache.set(mint, {
        holders,
        timestamp: Date.now(),
      });
      
      return holders;
    } catch (error) {
      logger.error({ error, mint }, 'Failed to get holders');
      return [];
    }
  }

  async getTopHolders(mint: string, count: number = 5): Promise<HolderInfo[]> {
    try {
      const holders = await this.getHolders(mint, count * 2); // Получаем больше для фильтрации
      return holders.slice(0, count);
    } catch (error) {
      logger.error({ error, mint }, 'Failed to get top holders');
      return [];
    }
  }

  async getHolderConcentration(mint: string, topCount: number = 5): Promise<{
    top1: number;
    top5: number;
    totalHolders: number;
  }> {
    try {
      const holders = await this.getHolders(mint, 1000);
      
      if (holders.length === 0) {
        return { top1: 0, top5: 0, totalHolders: 0 };
      }

      const top1 = holders[0]?.percentage || 0;
      const top5 = holders.slice(0, topCount).reduce((sum, holder) => sum + holder.percentage, 0);
      
      return {
        top1,
        top5,
        totalHolders: holders.length,
      };
    } catch (error) {
      logger.error({ error, mint }, 'Failed to get holder concentration');
      return { top1: 0, top5: 0, totalHolders: 0 };
    }
  }

  private async fetchHolders(mint: string, limit: number): Promise<HolderInfo[]> {
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const totalSupply = await this.connection.getTokenSupply(new PublicKey(mint), this.connection.commitment);
      const totalSupplyAmount = totalSupply.value.uiAmount || 0;
      
      if (totalSupplyAmount === 0) {
        return [];
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const largestAccounts = await this.connection.getTokenLargestAccounts(
        new PublicKey(mint),
        this.connection.commitment
      );
      
      const holders: HolderInfo[] = [];
      
      for (let i = 0; i < Math.min(largestAccounts.value.length, limit); i++) {
        const account = largestAccounts.value[i];
        if (account) {
          const amount = account.uiAmount || 0;
          const percentage = (amount / totalSupplyAmount) * 100;
          
          holders.push({
            address: account.address.toBase58(),
            amount: amount,
            percentage: percentage
          });
        }
      }
      
      logger.debug({ mint, holdersCount: holders.length, totalSupply: totalSupplyAmount }, 'Fetched real holders data');
      
      return holders;
    } catch (error) {
      logger.debug({ error, mint }, 'Failed to fetch holders');
      return [];
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }
}
