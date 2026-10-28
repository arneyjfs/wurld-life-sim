/**
 * SEC-HOST-3 (docs/specs/data-boundary.md §3c) — run zod without its JIT.
 *
 * zod 4 compiles object parsers with `new Function(...)` after probing
 * `new Function("")` in a try/catch. The Hosting CSP has no 'unsafe-eval', so
 * that probe is a CSP violation on every page load: harmless (zod falls back
 * to its interpreter) but, under the report-only policy, one Sentry report per
 * load. Jitless skips the probe entirely. Our schemas are small (Firestore
 * docs), so the interpreter's cost is noise.
 *
 * Side-effect module: imported FIRST in src/main.tsx so it runs before any
 * module parses a schema.
 */
import { z } from 'zod';

z.config({ jitless: true });
