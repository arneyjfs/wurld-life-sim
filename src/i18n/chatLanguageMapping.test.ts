/**
 * The mapping from chat-language English NAME → UI-locale code drives
 * the "Use as display language" radio in Settings. Wrong mapping →
 * wrong UI locale (or none at all) when the user picks the radio.
 * Pinning the key cases here so we catch regressions when SUPPORTED_LOCALES
 * or SUPPORTED_LANGUAGES changes.
 */
import { describe, expect, it } from 'vitest';
import { chatLanguageToUILocale } from './chatLanguageMapping';

describe('chatLanguageToUILocale', () => {
  it('falls through Spanish regional variants to the right UI locales', () => {
    expect(chatLanguageToUILocale('Spanish')).toBe('es');
    expect(chatLanguageToUILocale('Spanish (Mexico)')).toBe('es-MX');
    expect(chatLanguageToUILocale('Spanish (Latin America)')).toBe('es-419');
  });

  it('keeps Portuguese BR vs PT split (significant lexical difference)', () => {
    expect(chatLanguageToUILocale('Portuguese (Brazilian)')).toBe('pt-BR');
    expect(chatLanguageToUILocale('Portuguese (European)')).toBe('pt-PT');
  });

  it('collapses English regional variants to base `en` (one UI catalogue)', () => {
    expect(chatLanguageToUILocale('English (American)')).toBe('en');
    expect(chatLanguageToUILocale('English (British)')).toBe('en');
    expect(chatLanguageToUILocale('English (Australian)')).toBe('en');
    expect(chatLanguageToUILocale('English (Indian)')).toBe('en');
  });

  it('rewrites Mandarin TTS codes to standard zh-CN / zh-TW', () => {
    expect(chatLanguageToUILocale('Chinese (Mandarin)')).toBe('zh-CN');
    expect(chatLanguageToUILocale('Chinese (Taiwan)')).toBe('zh-TW');
  });

  it('handles Norwegian (TTS nb-NO → UI no)', () => {
    expect(chatLanguageToUILocale('Norwegian')).toBe('no');
  });

  it('returns the base code when only the language part is in the UI table', () => {
    expect(chatLanguageToUILocale('German')).toBe('de');
    expect(chatLanguageToUILocale('Italian')).toBe('it');
    expect(chatLanguageToUILocale('French (Canadian)')).toBe('fr-CA');
    expect(chatLanguageToUILocale('French')).toBe('fr');
  });

  it('handles RTL languages', () => {
    expect(chatLanguageToUILocale('Arabic (Egypt)')).toBe('ar');
    expect(chatLanguageToUILocale('Hebrew')).toBe('he');
    expect(chatLanguageToUILocale('Persian')).toBe('fa');
  });

  it('returns null for chat languages without a UI translation', () => {
    expect(chatLanguageToUILocale('Konkani')).toBeNull();
  });

  it('returns null for unknown / empty inputs', () => {
    expect(chatLanguageToUILocale(undefined)).toBeNull();
    expect(chatLanguageToUILocale(null)).toBeNull();
    expect(chatLanguageToUILocale('Klingon')).toBeNull();
    expect(chatLanguageToUILocale('')).toBeNull();
  });
});
