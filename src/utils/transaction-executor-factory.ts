import { Connection } from '@solana/web3.js';
import { config } from './config';
import { logger } from './logger';
import { 
  TransactionExecutor, 
  DefaultTransactionExecutor, 
  WarpTransactionExecutor, 
  JitoTransactionExecutor 
} from '../traders';

export class TransactionExecutorFactory {
  static createTransactionExecutor(
    connection: Connection,
  ): TransactionExecutor {
    const executorType = config.transactionExecutor;
    
    switch (executorType) {
      case 'warp':
        logger.info('Creating Warp transaction executor');
        return new WarpTransactionExecutor(config.customFee);
        
      case 'jito':
        logger.info('Creating Jito transaction executor');
        return new JitoTransactionExecutor(config.customFee, connection);
        
      case 'default':
      default:
        logger.info('Creating default transaction executor');
        return new DefaultTransactionExecutor(connection);
    }
  }
}
