import { describe, expect, it } from 'vitest';
import {
  isEmojiOnly,
  isNonLinguistic,
  isUrlOnly,
  shouldSkipTranslation,
} from './translationSkip';

describe('isEmojiOnly', () => {
  it('detects a single emoji', () => {
    expect(isEmojiOnly('😀')).toBe(true);
  });

  it('detects multiple emojis', () => {
    expect(isEmojiOnly('😀😎🎉')).toBe(true);
  });

  it('detects emojis with ZWJ (family)', () => {
    expect(isEmojiOnly('👨‍👩‍👧‍👦')).toBe(true);
  });

  it('detects emojis with skin tone modifiers', () => {
    expect(isEmojiOnly('👋🏻👋🏽')).toBe(true);
  });

  it('detects emojis with incidental whitespace', () => {
    expect(isEmojiOnly('  😀 😎  ')).toBe(true);
  });

  it('detects emojis with light punctuation', () => {
    expect(isEmojiOnly('😀!')).toBe(true);
    expect(isEmojiOnly('😀, 😎.')).toBe(true);
  });

  it('rejects emoji mixed with prose', () => {
    expect(isEmojiOnly('hello 😀')).toBe(false);
    expect(isEmojiOnly('😀 world')).toBe(false);
  });

  it('rejects empty / whitespace-only strings', () => {
    expect(isEmojiOnly('')).toBe(false);
    expect(isEmojiOnly('   ')).toBe(false);
    expect(isEmojiOnly(null)).toBe(false);
    expect(isEmojiOnly(undefined)).toBe(false);
  });

  it('rejects plain text', () => {
    expect(isEmojiOnly('hello')).toBe(false);
  });
});

describe('isUrlOnly', () => {
  it('detects https URL', () => {
    expect(isUrlOnly('https://example.com')).toBe(true);
    expect(isUrlOnly('https://example.com/path/to/thing?q=1')).toBe(true);
  });

  it('detects http URL', () => {
    expect(isUrlOnly('http://example.com')).toBe(true);
  });

  it('detects www. URL', () => {
    expect(isUrlOnly('www.example.com')).toBe(true);
  });

  it('tolerates leading/trailing whitespace', () => {
    expect(isUrlOnly('  https://example.com  ')).toBe(true);
  });

  it('rejects URL embedded in prose', () => {
    expect(isUrlOnly('check this https://example.com')).toBe(false);
    expect(isUrlOnly('https://example.com is cool')).toBe(false);
  });

  it('rejects bare domain without scheme/www', () => {
    expect(isUrlOnly('example.com')).toBe(false);
  });

  it('rejects empty / null', () => {
    expect(isUrlOnly('')).toBe(false);
    expect(isUrlOnly(null)).toBe(false);
    expect(isUrlOnly(undefined)).toBe(false);
  });
});

describe('MSG-BUBBLE-URL-8 — email-only messages are universal', () => {
  it('MSG-BUBBLE-URL-8 — an email-only message skips translation', () => {
    expect(isUrlOnly('jo@example.com')).toBe(true);
    expect(isUrlOnly('  jo.smith+x@mail.example.co.uk \n')).toBe(true);
    expect(shouldSkipTranslation('jo@example.com')).toBe(true);
  });

  it('MSG-BUBBLE-URL-8 — an email inside prose is still translated', () => {
    expect(isUrlOnly('mail me at jo@example.com')).toBe(false);
    expect(isUrlOnly('jo@example.com please')).toBe(false);
    expect(shouldSkipTranslation('mail me at jo@example.com')).toBe(false);
  });

  it('MSG-BUBBLE-URL-8 — non-emails are not skipped', () => {
    expect(isUrlOnly('@handle')).toBe(false);
    expect(isUrlOnly('a@b')).toBe(false);
    expect(isUrlOnly('a@b.c')).toBe(false);
    expect(isUrlOnly('jo@example.com.')).toBe(false);
    expect(isUrlOnly('jo@example.com jo@example.org')).toBe(false);
  });

  it('MSG-BUBBLE-URL-8 — URL-only behaviour is unchanged', () => {
    expect(isUrlOnly('https://example.com')).toBe(true);
    expect(isUrlOnly('www.example.com')).toBe(true);
    expect(isUrlOnly('example.com')).toBe(false);
  });
});

describe('isNonLinguistic', () => {
  it('detects the reported stuck message (numbers + newline + hyphens)', () => {
    expect(isNonLinguistic('20353281\n04-00-04')).toBe(true);
  });

  it('detects bare numbers, times, dates, prices, math', () => {
    expect(isNonLinguistic('12345')).toBe(true);
    expect(isNonLinguistic('04:00')).toBe(true);
    expect(isNonLinguistic('2026-07-23')).toBe(true);
    expect(isNonLinguistic('$1,000')).toBe(true);
    expect(isNonLinguistic('2+2=4')).toBe(true);
    expect(isNonLinguistic('!?!')).toBe(true);
  });

  it('is FALSE for anything with a letter in ANY script (translatable)', () => {
    expect(isNonLinguistic('Room 4B')).toBe(false); // Latin letter present
    expect(isNonLinguistic('10am')).toBe(false);
    expect(isNonLinguistic('你好')).toBe(false); // CJK letters
    expect(isNonLinguistic('привет')).toBe(false); // Cyrillic
    expect(isNonLinguistic('hello world')).toBe(false);
  });

  it('is FALSE for empty / whitespace-only (nothing to send)', () => {
    expect(isNonLinguistic('')).toBe(false);
    expect(isNonLinguistic('   ')).toBe(false);
    expect(isNonLinguistic(null)).toBe(false);
    expect(isNonLinguistic(undefined)).toBe(false);
  });
});

describe('shouldSkipTranslation', () => {
  it('skips emoji-only', () => {
    expect(shouldSkipTranslation('🎉')).toBe(true);
  });

  it('skips non-linguistic (numbers/symbols) — the stuck-message fix', () => {
    expect(shouldSkipTranslation('20353281\n04-00-04')).toBe(true);
    expect(shouldSkipTranslation('12345')).toBe(true);
  });

  it('skips URL-only', () => {
    expect(shouldSkipTranslation('https://example.com')).toBe(true);
  });

  it('translates ordinary prose', () => {
    expect(shouldSkipTranslation('hello world')).toBe(false);
  });

  it('translates mixed content', () => {
    expect(shouldSkipTranslation('check this https://example.com')).toBe(false);
    expect(shouldSkipTranslation('happy birthday 🎉')).toBe(false);
  });
});
