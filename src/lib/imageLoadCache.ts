/**
 * Tracks photo URLs that have successfully decoded at least once in
 * THIS SESSION, so the Avatar component can skip the "render blurred
 * LQIP underlay → swap to real image" transition on remount within the
 * same session.
 *
 * Without this, every navigation that unmounts + remounts an `<img>`
 * (chat list → chat → back) re-enters the `imgLoaded=false` state for a
 * tick even when the image is sitting in the HTTP cache, producing a
 * visible flicker. The cache here records "the browser has rendered
 * THIS URL before" so we can initialise `imgLoaded=true` synchronously
 * on remount.
 *
 * In-memory only — no localStorage. A previous version persisted to
 * localStorage so the cache survived full reloads, but that caused a
 * worse bug on cold loads where the HTTP cache had been evicted: the
 * persisted "wasLoaded=true" skipped the LQIP backdrop, then the <img>
 * had to fetch over the network, blanking the avatar for the fetch
 * duration. The cold-load + cold-HTTP-cache path is exactly what the
 * LQIP exists for, so we always paint it on first remount per session.
 * Within a session the in-memory Set still suppresses the LQIP flash
 * on navigation.
 */

const CAP = 500;
const loaded = new Set<string>();

export function wasLoaded(url: string | null | undefined): boolean {
  if (!url) return false;
  return loaded.has(url);
}

export function markLoaded(url: string | null | undefined): void {
  if (!url) return;
  if (loaded.has(url)) {
    // Bump to most-recent by re-inserting (Set keeps insertion order).
    loaded.delete(url);
  }
  loaded.add(url);
  if (loaded.size > CAP) {
    const first = loaded.values().next().value;
    if (first !== undefined) loaded.delete(first);
  }
}
