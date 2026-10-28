import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Tracks recently selected languages across the app. Used by LanguagePicker
 * to surface a "Recent" chip row above the full alphabetical list.
 *
 * Previous versions kept per-intent buckets (native / practice / chat) so
 * each picker showed only its own history. User feedback: the buckets
 * felt artificial — if you picked Spanish as a chat language you almost
 * certainly want it as a quick option in the native and practice
 * pickers too. Single shared list, LRU-capped at 6 entries. The
 * `bucket` argument to `pushRecent` is kept on the signature for
 * call-site clarity ("this is a native pick" reads at the call) but
 * has no functional effect on storage.
 */

type Bucket = 'native' | 'practice' | 'chat';
const CAP = 6;

type State = {
  recents: string[];
  pushRecent: (bucket: Bucket, language: string) => void;
};

export const useLanguageRecentsStore = create<State>()(
  persist(
    (set) => ({
      recents: [],
      pushRecent: (_bucket, language) =>
        set((s) => {
          const next = s.recents.filter((l) => l !== language);
          next.unshift(language);
          return { recents: next.slice(0, CAP) };
        }),
    }),
    {
      name: 'wurld:language-recents-v2',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export type LanguageBucket = Bucket;
