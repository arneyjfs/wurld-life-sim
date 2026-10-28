/**
 * A tiny in-memory Firestore for unit tests of code that reads and writes a
 * handful of docs, with or without a transaction. Paths are flat keys; there
 * are no queries, no sentinels and no listeners. `failCommit` makes the next
 * transaction throw at commit, with nothing applied — the all-or-nothing
 * property a real transaction gives.
 *
 * Not a test file: imported by `*.test.ts`.
 */
type Data = Record<string, unknown>;

export type FakeFirestore = ReturnType<typeof createFakeFirestore>;

export function createFakeFirestore(seed: Record<string, Data> = {}) {
  const docs = new Map<string, Data>(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  const state = { failCommit: false, transactions: 0 };

  const snap = (path: string) => {
    const d = docs.get(path);
    return { exists: d !== undefined, id: path.split("/").pop(), data: () => (d === undefined ? undefined : structuredClone(d)) };
  };

  const ref = (path: string) => ({
    path,
    id: path.split("/").pop(),
    get: async () => snap(path),
    set: async (data: Data) => void docs.set(path, structuredClone(data)),
    update: async (data: Data) => {
      if (!docs.has(path)) throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 });
      docs.set(path, { ...docs.get(path), ...structuredClone(data) });
    },
    delete: async () => void docs.delete(path),
  });

  const fs = {
    doc: (path: string) => ref(path),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      state.transactions++;
      const writes: Array<() => void> = [];
      const tx = {
        get: async (r: { path: string }) => snap(r.path),
        set: (r: { path: string }, data: Data) => void writes.push(() => docs.set(r.path, structuredClone(data))),
        update: (r: { path: string }, data: Data) =>
          void writes.push(() => {
            if (!docs.has(r.path)) throw Object.assign(new Error(`NOT_FOUND: ${r.path}`), { code: 5 });
            docs.set(r.path, { ...docs.get(r.path), ...structuredClone(data) });
          }),
      };
      const out = await fn(tx);
      if (state.failCommit) {
        state.failCommit = false;
        throw Object.assign(new Error("ABORTED: commit failed"), { code: 10 });
      }
      for (const w of writes) w();
      return out;
    },
  };

  return { fs, docs, state, read: (path: string) => docs.get(path) };
}
