// import { Transaction } from '@solana/web3.js';

/**
 * Получает строковое представление PublicKey по индексу, учитывая Address Lookup Tables
 */
export function getPublicKeyStringByIndex(tx: any, index: number): string | undefined {
  if (index < 0) return undefined;
  
  // Для TransactionWithMeta accountKeys находится в tx.transaction.message.accountKeys
  // Для ParsedTransactionWithMeta accountKeys находится в tx.transaction.message.accountKeys
  let accountKeys = tx.transaction?.message?.accountKeys;
  const loadedAddresses = tx.meta?.loadedAddresses;
  
  // Проверяем, что accountKeys существует
  if (!accountKeys) {
    console.log(`getPublicKeyStringByIndex: accountKeys is undefined, index=${index}`);
    console.log(`tx.transaction:`, !!tx.transaction);
    console.log(`tx.transaction.message:`, !!tx.transaction?.message);
    console.log(`tx.transaction.message.accountKeys:`, tx.transaction?.message?.accountKeys);
    console.log(`tx.transaction.message keys:`, tx.transaction?.message ? Object.keys(tx.transaction.message) : 'no message');
    console.log(`tx keys:`, Object.keys(tx));
    return undefined;
  }
  
  // Основные accountKeys
  if (index < accountKeys.length) {
    const result = accountKeys[index]?.pubkey?.toString();
    console.log(`getPublicKeyStringByIndex: found in accountKeys, index=${index}, accountKeys.length=${accountKeys.length}, result=${result}`);
    return result;
  }
  
  // Address Lookup Tables
  if (loadedAddresses) {
    const lookupIndex = index - accountKeys.length;
    console.log(`getPublicKeyStringByIndex: checking ALTs, index=${index}, accountKeys.length=${accountKeys.length}, lookupIndex=${lookupIndex}, writable.length=${loadedAddresses.writable.length}, readonly.length=${loadedAddresses.readonly.length}`);
    
    if (lookupIndex >= 0 && lookupIndex < loadedAddresses.writable.length) {
      const writable = loadedAddresses.writable[lookupIndex];
      if (writable) {
        const result = writable.toString();
        console.log(`getPublicKeyStringByIndex: found in writable ALTs, result=${result}`);
        return result;
      }
    }
    
    const readonlyIndex = lookupIndex - loadedAddresses.writable.length;
    if (readonlyIndex >= 0 && readonlyIndex < loadedAddresses.readonly.length) {
      const readonly = loadedAddresses.readonly[readonlyIndex];
      if (readonly) {
        const result = readonly.toString();
        console.log(`getPublicKeyStringByIndex: found in readonly ALTs, result=${result}`);
        return result;
      }
    }
  }
  
  console.log(`getPublicKeyStringByIndex: not found, index=${index}, accountKeys.length=${accountKeys.length}, loadedAddresses=${!!loadedAddresses}`);
  return undefined;
}
