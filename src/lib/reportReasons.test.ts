import { describe, expect, it } from 'vitest';
import { reasonsFor } from './reportReasons';

describe('SAFETY-REPORT-2 — the reasons the sheet offers', () => {
  it('SAFETY-REPORT-2 — a person\'s message offers person and AI reasons', () => {
    expect(reasonsFor('message')).toEqual(
      ['harassment', 'hate', 'sexual', 'violence', 'spam', 'ai_offensive', 'ai_wrong', 'other'],
    );
  });
  it('SAFETY-REPORT-2 — Report translation and AI messages offer AI reasons only', () => {
    expect(reasonsFor('message', { aiOnly: true })).toEqual(['ai_offensive', 'ai_wrong', 'other']);
    expect(reasonsFor('explanation')).toEqual(['ai_offensive', 'ai_wrong', 'other']);
    expect(reasonsFor('ai')).toEqual(['ai_offensive', 'ai_wrong', 'other']);
  });
  it('SAFETY-REPORT-2 — a person offers impersonation, never AI reasons', () => {
    expect(reasonsFor('user')).toEqual(['harassment', 'hate', 'sexual', 'violence', 'spam', 'impersonation', 'other']);
  });
});
