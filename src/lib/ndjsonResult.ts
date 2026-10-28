/**
 * MSG-PIPE-32.4 — the client half of the send response's preview stream.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-PIPE-32.4.
 *
 * A streamed response is `200 application/x-ndjson`: any number of
 * `{"preview":…}` lines, then exactly one `{"result":{"status","body"}}` line
 * that stands for the status + JSON body a plain response would have carried.
 */
export function isNdjsonResponse(res: Response): boolean {
  // Optional chaining: test doubles and some fetch shims carry no headers.
  return (res.headers?.get?.('Content-Type') ?? '').includes('application/x-ndjson');
}

/** Reads the stream to its result line, handing every other line to `onLine`
 *  as it arrives. A stream that ends without one is a dropped connection, so it
 *  throws the TypeError a failed fetch throws (`network/offline`, retried).
 *  Resolves AT the result line: the server may keep the connection open after
 *  it (TUTOR-INV-27.2), and the rest is drained in the background. */
export async function readNdjsonResult(
  res: Response,
  onLine: (line: Record<string, unknown>) => void,
): Promise<{ status: number; body: unknown }> {
  let result: { status: number; body: unknown } | null = null;
  const take = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed || result) return;
    let line: unknown;
    try {
      line = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!line || typeof line !== 'object') return;
    const r = (line as { result?: { status?: unknown; body?: unknown } }).result;
    if (r && typeof r.status === 'number') {
      result = { status: r.status, body: r.body };
      return;
    }
    try {
      onLine(line as Record<string, unknown>);
    } catch {
      // A preview consumer never breaks the send it rides on.
    }
  };

  const reader = res.body?.getReader();
  if (!reader) {
    // No streaming body (a buffering fetch): the same lines, all at once.
    for (const raw of (await res.text()).split('\n')) take(raw);
  } else {
    const decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
      const { done, value } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const raw of lines) take(raw);
      if (done) break;
      if (result) {
        void drain(reader);
        return result;
      }
    }
    take(buffered);
  }
  if (!result) throw new TypeError('stream ended without a result');
  return result;
}

/** Reads a held-open stream to its end without waiting on it; nothing after
 *  the result line is meaningful, and a dropped connection here is harmless. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } catch {
    // The send already settled.
  }
}
