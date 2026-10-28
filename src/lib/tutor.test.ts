import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- Firestore mock ----------------------------------------------------
// A single virtual store keyed by ref-path; transactions serialise via a
// mutex so we can validate "atomic create-if-not-exists" under concurrency.

type Path = string;
type StoredDoc = Record<string, unknown>;
type Ref = { __path: Path };

const store = new Map<Path, StoredDoc>();
const contactWrites: Array<{ ref: Path; data: StoredDoc; opts?: unknown }> = [];
const chatUpdates: Array<{ ref: Path; data: StoredDoc }> = [];

function refOf(...parts: string[]): Ref {
  return { __path: parts.filter(Boolean).join('/') };
}

let txMutex: Promise<void> = Promise.resolve();

vi.mock('./config', () => ({
  config: {
    env: 'dev',
    firebase: {
      apiKey: 'k',
      authDomain: 'a',
      projectId: 'p',
      storageBucket: 's',
      messagingSenderId: 'm',
      appId: 'app',
    },
    functionsUrl: 'https://us-central1-test.cloudfunctions.net',
  },
}));

vi.mock('./firebase', () => ({
  firebaseApp: {},
  auth: { currentUser: null },
  db: { __mock: true },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => refOf(...parts),
  collection: (_db: unknown, ...parts: string[]) => refOf(...parts),
  serverTimestamp: () => '__SERVER_TS__',
  setDoc: async (ref: Ref, data: StoredDoc, opts?: unknown) => {
    contactWrites.push({ ref: ref.__path, data, opts });
    const existing = store.get(ref.__path) ?? {};
    store.set(ref.__path, { ...existing, ...data });
  },
  updateDoc: async (ref: Ref, data: StoredDoc) => {
    chatUpdates.push({ ref: ref.__path, data });
    const existing = store.get(ref.__path) ?? {};
    store.set(ref.__path, { ...existing, ...data });
  },
  runTransaction: async <T>(
    _db: unknown,
    fn: (tx: {
      get: (ref: Ref) => Promise<{ exists: () => boolean; data: () => StoredDoc | undefined }>;
      set: (ref: Ref, data: StoredDoc) => void;
    }) => Promise<T>,
  ): Promise<T> => {
    let release: () => void = () => {};
    const next = new Promise<void>((r) => {
      release = r;
    });
    const prev = txMutex;
    txMutex = prev.then(() => next);
    await prev;
    try {
      const tx = {
        get: async (ref: Ref) => ({
          exists: () => store.has(ref.__path),
          data: () => store.get(ref.__path),
        }),
        set: (ref: Ref, data: StoredDoc) => {
          store.set(ref.__path, data);
        },
      };
      return await fn(tx);
    } finally {
      release();
    }
  },
}));

vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => async () => ({ data: {} }),
}));

// Capture every `callHttp` invocation so we can assert what the bootstrap
// fires (e.g. the setup `seed` trigger to `tutorRespond`).
const httpCalls: Array<{ endpoint: string; body: unknown }> = [];
vi.mock('./endpoints', () => ({
  callHttp: async (endpoint: string, body: unknown) => {
    httpCalls.push({ endpoint, body });
    return { ok: true };
  },
}));

beforeEach(() => {
  store.clear();
  contactWrites.length = 0;
  chatUpdates.length = 0;
  httpCalls.length = 0;
  txMutex = Promise.resolve();
});

// ---------- Pure helpers ------------------------------------------------------

describe('tutor helpers', () => {
  it('isTutorUid is true only for the synthetic agent uid', async () => {
    const { isTutorUid, TUTOR_UID } = await import('./tutor');
    expect(isTutorUid(TUTOR_UID)).toBe(true);
    expect(isTutorUid('some-real-uid')).toBe(false);
    expect(isTutorUid(undefined)).toBe(false);
    expect(isTutorUid(null)).toBe(false);
    expect(isTutorUid('')).toBe(false);
  });

  it('directChatId is deterministic and order-independent', async () => {
    const { directChatId } = await import('./tutor');
    expect(directChatId('abc', 'xyz')).toBe(directChatId('xyz', 'abc'));
    expect(directChatId('a', 'b')).toMatch(/^direct_/);
    expect(directChatId('alpha', 'beta')).toBe(directChatId('alpha', 'beta'));
  });

  it('directChatId equals `direct_` + sorted uids', async () => {
    const { directChatId } = await import('./tutor');
    expect(directChatId('zed', 'alice')).toBe('direct_alice_zed');
  });
});

// ---------- ensureTutorChat idempotency --------------------------------------

function countChatDocs(): number {
  return Array.from(store.keys()).filter(
    (k) => k.startsWith('chats/') && !k.includes('/messages/'),
  ).length;
}

describe('ensureTutorChat — single call', () => {
  it('creates contact + chat with deterministic ids and reports isNew=true', async () => {
    const { ensureTutorChat, directChatId, TUTOR_UID } = await import('./tutor');
    const { chatId, isNew } = await ensureTutorChat('user-A', 'Alice');

    expect(chatId).toBe(directChatId('user-A', TUTOR_UID));
    expect(isNew).toBe(true);

    // Tutor contact written under the user's contacts sub-collection at
    // the deterministic id.
    expect(contactWrites.length).toBeGreaterThanOrEqual(1);
    expect(
      contactWrites.some((w) => w.ref.endsWith(`contacts/${TUTOR_UID}`)),
    ).toBe(true);

    // Chat doc exists at the deterministic id.
    const chatPath = `chats/${chatId}`;
    expect(store.has(chatPath)).toBe(true);
    const chatData = store.get(chatPath);
    expect(chatData?.members).toEqual(['user-A', TUTOR_UID]);
  });
});

describe('ensureTutorChat — second call returns existing', () => {
  it('isNew=false on re-call, same chatId, no new chat doc written', async () => {
    const { ensureTutorChat, directChatId, TUTOR_UID } = await import('./tutor');
    await ensureTutorChat('user-A', 'Alice');
    const writesAfterFirst = contactWrites.length;

    const second = await ensureTutorChat('user-A', 'Alice');
    expect(second.isNew).toBe(false);
    expect(second.chatId).toBe(directChatId('user-A', TUTOR_UID));

    expect(countChatDocs()).toBe(1);
    expect(store.has(`chats/${directChatId('user-A', TUTOR_UID)}`)).toBe(true);

    // Contact writes can repeat with merge — the invariant is no extra
    // chat doc.
    expect(contactWrites.length).toBeGreaterThanOrEqual(writesAfterFirst);
  });
});

describe('ensureTutorChat — concurrent calls', () => {
  it('10 concurrent calls produce exactly one chat doc', async () => {
    const { ensureTutorChat, directChatId, TUTOR_UID } = await import('./tutor');
    const calls = Array.from({ length: 10 }, () =>
      ensureTutorChat('user-A', 'Alice'),
    );
    const results = await Promise.all(calls);

    expect(countChatDocs()).toBe(1);
    const expectedChatId = directChatId('user-A', TUTOR_UID);
    expect(store.has(`chats/${expectedChatId}`)).toBe(true);

    expect(results.every((r) => r.chatId === expectedChatId)).toBe(true);
    const newCount = results.filter((r) => r.isNew).length;
    expect(newCount).toBe(1);
  });
});

// ---------- writeTutorMessage idempotency -----------------------------

describe('writeTutorMessage — idempotent by deterministic id', () => {
  it('first call reports isNew=true and writes one message doc', async () => {
    const { writeTutorMessage } = await import('./tutor');
    store.set('chats/direct_fake', { isGroup: false });

    const r = await writeTutorMessage(
      'direct_fake',
      'welcome',
      'Hi!',
      'English (British)',
    );
    expect(r.isNew).toBe(true);
    expect(r.messageId).toBe('welcome');
    expect(store.has('chats/direct_fake/messages/welcome')).toBe(true);
  });

  it('second call reports isNew=false and does not overwrite', async () => {
    const { writeTutorMessage } = await import('./tutor');
    store.set('chats/direct_fake', { isGroup: false });

    const first = await writeTutorMessage(
      'direct_fake',
      'welcome',
      'Hi!',
      'English (British)',
    );
    const second = await writeTutorMessage(
      'direct_fake',
      'welcome',
      'Different greeting',
      'English (British)',
    );
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);

    const msg = store.get('chats/direct_fake/messages/welcome') as
      | { originalText?: string }
      | undefined;
    expect(msg?.originalText).toBe('Hi!');
  });

  it('10 concurrent calls produce exactly one isNew=true', async () => {
    const { writeTutorMessage } = await import('./tutor');
    store.set('chats/direct_fake', { isGroup: false });

    const calls = Array.from({ length: 10 }, () =>
      writeTutorMessage('direct_fake', 'welcome', 'Hi!', 'English (British)'),
    );
    const results = await Promise.all(calls);
    const newCount = results.filter((r) => r.isNew).length;
    expect(newCount).toBe(1);
    expect(store.has('chats/direct_fake/messages/welcome')).toBe(true);
  });
});

// ---------- bootstrap opens the setup-mode walkthrough (TUTOR-SETUP-5) -------

describe('bootstrapTutorChatOnce — opens the setup walkthrough', () => {
  it('TUTOR-SETUP-5 — a new tutor chat fires tutorRespond { setupTrigger: "seed" } and writes NO legacy welcome', async () => {
    // The old native-only welcome + translateTutorMessage path is retired:
    // the server now authors the bilingual "offer the tour" message itself
    // when seeded, so the client just fires the seed trigger on chat
    // creation.
    const { bootstrapTutorChatOnce, TUTOR_UID } = await import('./tutor');

    await bootstrapTutorChatOnce({
      uid: 'u-seed-spanish',
      displayName: 'Carla',
      nativeLanguage: 'Spanish',
      practiceLanguage: 'English (American)',
      difficulty: 2,
    });

    const seedCall = httpCalls.find(
      (c) =>
        c.endpoint === 'tutorRespond' &&
        (c.body as { setupTrigger?: string }).setupTrigger === 'seed',
    );
    expect(seedCall).toBeDefined();
    expect((seedCall!.body as { chatId?: string }).chatId).toContain(TUTOR_UID);

    // No legacy welcome doc, no translateTutorMessage call.
    const welcomePath = Array.from(store.keys()).find((k) =>
      k.endsWith('/messages/welcome'),
    );
    expect(welcomePath).toBeUndefined();
    expect(
      httpCalls.find((c) => c.endpoint === 'translateTutorMessage'),
    ).toBeUndefined();
  });

  it('does NOT seed an existing tutor chat (isNew=false → returning user stays in normal mode)', async () => {
    const { bootstrapTutorChatOnce, directChatId, TUTOR_UID } = await import('./tutor');
    const uid = 'u-existing-chat';
    // Pre-create the chat doc so ensureTutorChat reports isNew=false.
    store.set(`chats/${directChatId(uid, TUTOR_UID)}`, {
      isGroup: false,
      members: [uid, TUTOR_UID],
    });

    await bootstrapTutorChatOnce({
      uid,
      displayName: 'Ed',
      nativeLanguage: 'English',
      practiceLanguage: 'French',
    });

    expect(httpCalls.find((c) => c.endpoint === 'tutorRespond')).toBeUndefined();
  });

  it('TUTOR-SETUP-5 — resetTutorBootstrap re-seeds after the tutor chat is deleted', async () => {
    const { bootstrapTutorChatOnce, resetTutorBootstrap, directChatId, TUTOR_UID } =
      await import('./tutor');
    const uid = 'u-delete-reseed';
    const chatPath = `chats/${directChatId(uid, TUTOR_UID)}`;
    const seedCalls = () =>
      httpCalls.filter(
        (c) =>
          c.endpoint === 'tutorRespond' &&
          (c.body as { setupTrigger?: string }).setupTrigger === 'seed',
      ).length;

    // 1. Brand-new chat → seeds once.
    await bootstrapTutorChatOnce({ uid, displayName: 'A', nativeLanguage: 'English', practiceLanguage: 'French' });
    expect(seedCalls()).toBe(1);

    // 2. Same session: the once-per-session guard blocks a re-run (no re-seed).
    await bootstrapTutorChatOnce({ uid, displayName: 'A', nativeLanguage: 'English', practiceLanguage: 'French' });
    expect(seedCalls()).toBe(1);

    // 3. Delete the chat + reset the guard (the OneToOneInfo delete path) →
    //    the re-created chat is `isNew` again and re-seeds.
    store.delete(chatPath);
    resetTutorBootstrap(uid);
    await bootstrapTutorChatOnce({ uid, displayName: 'A', nativeLanguage: 'English', practiceLanguage: 'French' });
    expect(seedCalls()).toBe(2);
  });
});

// ---------- setup-mode trigger plumbing (TUTOR-SETUP-5) ---------------------

describe('requestSetupTrigger — routes setup events to tutorRespond', () => {
  it('TUTOR-SETUP-5 — posts the setupTrigger with no userMessageId', async () => {
    const { requestSetupTrigger } = await import('./tutor');
    await requestSetupTrigger('direct_abc', 'view_mode_set');
    const call = httpCalls.find((c) => c.endpoint === 'tutorRespond');
    expect(call).toBeDefined();
    // Core fields (requestTutorReply also injects appLanguage from the UI locale).
    expect(call!.body).toMatchObject({ chatId: 'direct_abc', setupTrigger: 'view_mode_set' });
    // No userMessageId — this is a pure trigger, not a reply to a message.
    expect((call!.body as { userMessageId?: string }).userMessageId).toBeUndefined();
    // TUTOR-ACTION-7: the app/display language is attached for the explain action.
    expect((call!.body as { appLanguage?: string }).appLanguage).toBe('English');
  });

  it('TUTOR-SETUP-5 — seed and skip route through the same endpoint', async () => {
    const { requestSetupTrigger } = await import('./tutor');
    await requestSetupTrigger('direct_seed', 'seed');
    await requestSetupTrigger('direct_skip', 'skip');
    const calls = httpCalls.filter((c) => c.endpoint === 'tutorRespond');
    expect(calls.map((c) => (c.body as { setupTrigger?: string }).setupTrigger)).toEqual(['seed', 'skip']);
  });
});
