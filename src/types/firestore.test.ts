import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  ZImageAttachment,
  ZPracticeEvent,
  ZPracticeQuestionType,
  ZUser,
  isVideoAttachment,
  parseDoc,
} from './firestore';

// AUTH-PROFILE-9 — `uid` derives from the doc id, so a `users/{uid}` doc that
// never stored a redundant `uid` field (writeUserSetting omits it) still parses.
// Before this, parseDoc returned null → null profile → the onboarding gate
// wedged on accept-legal (Continue disabled but the screen never advanced).
describe('ZUser — uid derives from the doc id (AUTH-PROFILE-9)', () => {
  it('parses a profile doc with no stored `uid` field', () => {
    const parsed = parseDoc(ZUser, 'HOk6cZMMhQddPeMwAUfImmnMA5X2', {
      displayName: 'Sam',
      acceptedTermsVersion: 2,
      acceptedPrivacyVersion: 2,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.uid).toBe('HOk6cZMMhQddPeMwAUfImmnMA5X2');
    expect(parsed?.acceptedTermsVersion).toBe(2);
  });

  it('uid is the doc id — a stale stored uid field is ignored', () => {
    // The doc id is authoritative (users/{uid}); a stored uid is redundant.
    const parsed = parseDoc(ZUser, 'realDocId', { uid: 'stale', displayName: 'X' });
    expect(parsed?.uid).toBe('realDocId');
  });

  it('still rejects genuine drift on other fields (transform does not mask it)', () => {
    const parsed = parseDoc(ZUser, 'docId', { displayName: 123 });
    expect(parsed).toBeNull();
  });

  it('MSG-VIEW-7 — an invalid viewSettings block degrades to undefined — does NOT drop the whole profile', () => {
    // parseDoc returns null on ANY failure, so without the field's
    // .catch(undefined) the entire profile (incl. fcmTokens) would vanish
    // client-side — and the user would drop out of the admin recipient list.
    const parsed = parseDoc(ZUser, 'docId', {
      displayName: 'Sam',
      viewSettings: { primary: 'totally-not-a-valid-primary' },
      fcmTokens: ['tok-1'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.viewSettings).toBeUndefined();
    expect(parsed?.fcmTokens).toEqual(['tok-1']);
  });

  it('DEAD-4 — the retired viewMode / vocabSwap fields are not part of the user schema', () => {
    const parsed = parseDoc(ZUser, 'docId', { displayName: 'Sam', viewMode: 'hidden', vocabSwap: true });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('viewMode');
    expect(parsed).not.toHaveProperty('vocabSwap');
  });
});

describe('ZPracticeQuestionType', () => {
  it('accepts every known questionType variant', () => {
    for (const qt of [
      'multiple-choice',
      'native-to-practice',
      'listen-and-pick',
      'listen-and-write',
      'vocab-matching',
    ]) {
      expect(ZPracticeQuestionType.parse(qt)).toBe(qt);
    }
  });

  it('rejects an unknown variant', () => {
    expect(ZPracticeQuestionType.safeParse('write-and-shout').success).toBe(
      false,
    );
  });
});

describe('ZPracticeEvent', () => {
  const ts = Timestamp.fromMillis(Date.UTC(2026, 0, 1));

  it('parses the minimal required shape', () => {
    const parsed = ZPracticeEvent.parse({
      uid: 'u1',
      questionType: 'multiple-choice',
      correct: true,
      createdAt: ts,
    });
    expect(parsed.uid).toBe('u1');
    expect(parsed.correct).toBe(true);
    expect(parsed.createdAt?.toMillis()).toBe(ts.toMillis());
  });

  it('passes optional analytics fields through unchanged', () => {
    const parsed = ZPracticeEvent.parse({
      uid: 'u2',
      questionType: 'listen-and-write',
      correct: false,
      createdAt: ts,
      sessionId: 'sess_1',
      cardId: 'card_1',
      topic: 'food',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      tokensUsed: 128,
    });
    expect(parsed).toMatchObject({
      sessionId: 'sess_1',
      cardId: 'card_1',
      topic: 'food',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      tokensUsed: 128,
    });
  });

  it('rejects missing required string / boolean fields', () => {
    expect(
      ZPracticeEvent.safeParse({
        questionType: 'multiple-choice',
        correct: true,
        createdAt: ts,
      }).success,
    ).toBe(false);
    expect(
      ZPracticeEvent.safeParse({
        uid: 'u1',
        correct: true,
        createdAt: ts,
      }).success,
    ).toBe(false);
    expect(
      ZPracticeEvent.safeParse({
        uid: 'u1',
        questionType: 'multiple-choice',
        createdAt: ts,
      }).success,
    ).toBe(false);
  });

  it('coerces an unparseable createdAt to undefined rather than failing the doc', () => {
    // Mirrors the lenient drift handling baked into ZTimestamp — preserves
    // the rest of the doc even when the timestamp is missing or
    // malformed (e.g. an in-flight serverTimestamp() sentinel read from
    // a snapshot before the server commit).
    const parsed = ZPracticeEvent.parse({
      uid: 'u1',
      questionType: 'multiple-choice',
      correct: true,
      createdAt: null,
    });
    expect(parsed.createdAt).toBeUndefined();
    expect(parsed.uid).toBe('u1');
  });

  it('rejects an invalid questionType', () => {
    expect(
      ZPracticeEvent.safeParse({
        uid: 'u1',
        questionType: 'fill-in-blanks',
        correct: true,
        createdAt: ts,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-boolean correct field', () => {
    expect(
      ZPracticeEvent.safeParse({
        uid: 'u1',
        questionType: 'multiple-choice',
        correct: 'yes',
        createdAt: ts,
      }).success,
    ).toBe(false);
  });

  it('rejects a negative tokensUsed value', () => {
    expect(
      ZPracticeEvent.safeParse({
        uid: 'u1',
        questionType: 'multiple-choice',
        correct: true,
        createdAt: ts,
        tokensUsed: -5,
      }).success,
    ).toBe(false);
  });

  it('accepts the raw `{seconds,nanoseconds}` Timestamp shape for createdAt', () => {
    // Some legacy / server-written docs land with the raw shape; ZTimestamp
    // coerces it. Confirm ZPracticeEvent inherits that behaviour.
    const parsed = ZPracticeEvent.parse({
      uid: 'u1',
      questionType: 'multiple-choice',
      correct: true,
      createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    });
    expect(parsed.createdAt?.toMillis()).toBe(1_700_000_000 * 1000);
  });
});

describe('ZImageAttachment — video items (VID-SCHEMA-1)', () => {
  it('VID-SCHEMA-1 — a video item keeps kind, videoUrl, durationMs and sizeBytes', () => {
    const parsed = ZImageAttachment.parse({
      kind: 'video',
      url: 'https://srv/poster.jpg',
      thumbUrl: 'https://srv/poster_t.jpg',
      tinyImage: 'data:image/jpeg;base64,A',
      width: 720,
      height: 1280,
      videoUrl: 'https://srv/clip.mp4',
      durationMs: 12_345,
      sizeBytes: 4_000_000,
    });
    expect(parsed.kind).toBe('video');
    expect(parsed.videoUrl).toBe('https://srv/clip.mp4');
    expect(parsed.durationMs).toBe(12_345);
    expect(parsed.sizeBytes).toBe(4_000_000);
    expect(isVideoAttachment(parsed)).toBe(true);
  });

  it('VID-SCHEMA-1 — an item with no kind is an image (legacy docs stay readable)', () => {
    const parsed = ZImageAttachment.parse({ url: 'https://srv/a.jpg' });
    expect(parsed.kind).toBeUndefined();
    expect(isVideoAttachment(parsed)).toBe(false);
  });

  it('VID-SCHEMA-1 — an unknown kind is rejected', () => {
    expect(ZImageAttachment.safeParse({ url: 'x', kind: 'gif' }).success).toBe(false);
  });

  it('VID-SCHEMA-1 — kind:"video" without a videoUrl is not treated as playable video', () => {
    expect(isVideoAttachment({ url: 'x', kind: 'video' })).toBe(false);
  });
});
