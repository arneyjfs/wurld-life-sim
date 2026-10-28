/**
 * Sampling-temperature policy for every CLIENT-DIRECT Gemini call.
 *
 * Its own module, mirroring `functions/src/temperature.ts`, for a mundane but
 * decisive reason: the practice generators unit-test with `vi.mock('../gemini')`,
 * and a constant living in that module would force all eight of those mocks to
 * grow a stub for it. A policy constant should not be mockable in the first
 * place.
 *
 * MSG-PIPE-23 (client half) — sampling temperature is a DECISION, not a default.
 *
 * Audited 2026-08-01 alongside the server registry (`TEMPERATURE` in
 * `functions/src/index.ts`). Every call that omits `temperature` runs at the
 * Gemini default of 1.0 — the setting for creative writing. Some of these calls
 * genuinely want that; none of them had SAID so, which is the actual problem:
 * a value nobody chose cannot be reviewed, and the message pipeline's 2026-08-01
 * mis-detection was an intermittency that an unchosen 1.0 was feeding.
 *
 * `topics.ts` (0.1) and `translatePhrase.ts` (0.2) already pinned their own and
 * are left alone. The life sim owns LIFE-TEMP-1/2/3.
 */
export const CLIENT_TEMPERATURE = {
  /** One right answer; variety is pure risk. */
  deterministic: 0.2,
  /** Prose a person reads, under a fixed output contract. Below 1.0 because
   *  the contract gets sloppier as temperature climbs, above `deterministic`
   *  because a stilted explanation is a worse explanation. */
  exposition: 0.6,
  /**
   * Deliberately AT the Gemini default — practice-question generation is the
   * one surface where sampling variety is a feature, not noise: a learner who
   * meets the same card twice should not meet the same question twice.
   *
   * Named rather than omitted so it reads as a choice. NOT re-tuned in the
   * 2026-08-01 audit: these seven generators each have their own prompt-eval
   * suite (`tests/prompts/practice-generator-*`), and lowering the temperature
   * is a question-quality change that has to be MEASURED against those suites
   * rather than asserted. My suspicion is that ~0.7 would generate better
   * questions with ample variety still coming from the card selection, but
   * that is a hypothesis and it is written down here as one.
   */
  varied: 1.0,
} as const;
