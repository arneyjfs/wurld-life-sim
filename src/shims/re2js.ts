/**
 * BOOT-SPLIT-8 — stand-in for `re2js`, aliased in vite.config.ts.
 *
 * @firebase/firestore (>= 12.14) imports re2js only for the Pipelines `like`,
 * `regex_contains` and `regex_match` evaluators. This app runs no Pipelines,
 * and every call site wraps `RE2JS.compile` in a try/catch that logs and
 * returns an error result, so throwing here degrades rather than crashes.
 */
export const RE2JS = {
  compile(_pattern: string): never {
    throw new Error('re2js is stubbed out of the client bundle (BOOT-SPLIT-8)');
  },
};
