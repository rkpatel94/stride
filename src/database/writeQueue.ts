import type { SqlDatabase } from './types';

/**
 * expo-sqlite's withTransactionAsync is not exclusive: any other async query issued while it
 * is open runs inside that transaction. All writes therefore go through this queue, which runs
 * them strictly one after another.
 */
let tail: Promise<unknown> = Promise.resolve();

export function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

export function writeTransaction(db: SqlDatabase, task: () => Promise<void>): Promise<void> {
  return serializeWrite(() => db.withTransactionAsync(task));
}
