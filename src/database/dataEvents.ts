/**
 * Minimal change notification: any write that affects activities, goals or achievements bumps
 * the version, and screens re-query. Keeps every displayed metric derived from the database.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let version = 0;

export function notifyDataChanged(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDataVersion(): number {
  return version;
}
