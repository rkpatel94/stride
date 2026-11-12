import type { SqlDatabase } from './types';

/**
 * withTransactionAsync is not exclusive: the database has one connection, so any other async
 * query issued while a transaction is open runs inside it. All writes therefore go through this
 * queue, which runs them strictly one after another.
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
