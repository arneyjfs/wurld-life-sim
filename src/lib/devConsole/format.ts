/**
 * DEVCON-CON-4 / DEVCON-CON-5 — turning arbitrary console arguments into a
 * string a human can read on a phone, with hard caps so a Firestore snapshot
 * can't blow the buffer.
 *
 * Deliberately NOT `JSON.stringify`: we need per-string, per-array, per-key and
 * per-depth caps, circular tolerance, and a guarantee that nothing here ever
 * throws (a formatting bug must never break the app's own logging — see
 * DEVCON-CON-1).
 *
 * Spec: docs/specs/dev-console.md §3.
 */

/** DEVCON-CON-5 — the shipped truncation caps. Asserted by format.test.ts. */
export const CAPS = {
  jsonDepth: 4,
  jsonStringChars: 500,
  jsonArrayItems: 50,
  jsonObjectKeys: 50,
  consoleEntryChars: 2000,
  requestBodyChars: 4000,
  responseBodyChars: 4000,
} as const;

/** DEVCON-CON-5 — cut to `cap`, marking the original length. */
export function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}… (truncated, ${text.length} chars total)`;
}

function capString(value: string): string {
  if (value.length <= CAPS.jsonStringChars) return value;
  return `${value.slice(0, CAPS.jsonStringChars)}…+${value.length - CAPS.jsonStringChars}`;
}

function fnLabel(value: unknown): string {
  const name = (value as { name?: unknown }).name;
  return `[Function: ${typeof name === 'string' && name ? name : 'anonymous'}]`;
}

function formatError(err: Error): string {
  const head = `${err.name}: ${err.message}`;
  const stack = typeof err.stack === 'string' ? err.stack : '';
  // V8 stacks already start with "Name: message"; don't print it twice.
  return stack.startsWith(err.name) ? stack : stack ? `${head}\n${stack}` : head;
}

/** Best-effort `toJSON()` unwrap. Returns `undefined` when there isn't one. */
function viaToJson(value: object): { ok: true; value: unknown } | { ok: false } | undefined {
  let toJson: unknown;
  try {
    toJson = (value as { toJSON?: unknown }).toJSON;
  } catch {
    return { ok: false };
  }
  if (typeof toJson !== 'function') return undefined;
  try {
    return { ok: true, value: (toJson as () => unknown).call(value) };
  } catch {
    return { ok: false };
  }
}

function serialize(value: unknown, depth: number, seen: Set<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const kind = typeof value;
  if (kind === 'string') return JSON.stringify(capString(value as string));
  if (kind === 'number' || kind === 'boolean') return String(value);
  if (kind === 'bigint') return String(value);
  if (kind === 'symbol') return JSON.stringify(String(value));
  if (kind === 'function') return JSON.stringify(fnLabel(value));

  const obj = value as object;
  if (value instanceof Error) return JSON.stringify(formatError(value));
  if (seen.has(obj)) return '[Circular]';

  const unwrapped = viaToJson(obj);
  if (unwrapped) {
    if (!unwrapped.ok) return '[Unserializable]';
    // A toJSON that returns the object itself would loop; the `seen` guard
    // below catches that on the next pass.
    if (unwrapped.value !== value) {
      seen.add(obj);
      try {
        return serialize(unwrapped.value, depth, seen);
      } finally {
        seen.delete(obj);
      }
    }
  }

  if (Array.isArray(value)) {
    if (depth >= CAPS.jsonDepth) return '[Array]';
    seen.add(obj);
    try {
      const shown = value.slice(0, CAPS.jsonArrayItems);
      const parts = shown.map((item) => serializeSafe(item, depth + 1, seen));
      if (value.length > CAPS.jsonArrayItems) {
        parts.push(JSON.stringify(`…+${value.length - CAPS.jsonArrayItems} more`));
      }
      return `[${parts.join(',')}]`;
    } finally {
      seen.delete(obj);
    }
  }

  if (depth >= CAPS.jsonDepth) return '[Object]';
  let keys: string[];
  try {
    keys = Object.keys(obj);
  } catch {
    return '[Unserializable]';
  }
  seen.add(obj);
  try {
    const shown = keys.slice(0, CAPS.jsonObjectKeys);
    const parts = shown.map((key) => {
      let child: unknown;
      try {
        child = (obj as Record<string, unknown>)[key];
      } catch {
        return `${JSON.stringify(key)}:"[Unserializable]"`;
      }
      return `${JSON.stringify(key)}:${serializeSafe(child, depth + 1, seen)}`;
    });
    if (keys.length > CAPS.jsonObjectKeys) {
      parts.push(`"…":${JSON.stringify(`+${keys.length - CAPS.jsonObjectKeys} more`)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

function serializeSafe(value: unknown, depth: number, seen: Set<object>): string {
  try {
    return serialize(value, depth, seen);
  } catch {
    return '"[Unserializable]"';
  }
}

/**
 * DEVCON-CON-4 — one console argument → a readable string. Strings pass
 * through verbatim (they're the common case and quoting them adds noise);
 * everything else is depth-capped, circular-safe JSON.
 */
export function formatValue(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return formatError(value);
    if (value === null || value === undefined) return String(value);
    const kind = typeof value;
    if (kind === 'number' || kind === 'boolean' || kind === 'bigint' || kind === 'symbol') {
      return String(value);
    }
    if (kind === 'function') return fnLabel(value);
    return serialize(value, 0, new Set());
  } catch {
    return '[Unserializable]';
  }
}

/** DEVCON-CON-4/5 — the full argument list of one console call. */
export function formatLogArgs(args: unknown[]): string {
  try {
    return truncate(args.map(formatValue).join(' '), CAPS.consoleEntryChars);
  } catch {
    return '[unformattable log entry]';
  }
}
