// ============================================================
// NeuroSustain — i18n Module
// Runtime locale switching with template interpolation
// ============================================================

import type { Locale } from './types.ts';
import { db } from './db.ts';

type TranslationDict = Record<string, string>;

let _currentLocale: Locale = 'en';
let _translations: TranslationDict = {};
const _listeners: Set<() => void> = new Set();

/** Load a locale's translation file */
async function load_locale_file(locale: Locale): Promise<TranslationDict> {
  const module = await import(`../assets/i18n/${locale}.json`);
  return module.default as TranslationDict;
}

/** Initialize i18n from stored profile or browser language */
export async function init_i18n(): Promise<void> {
  const profile = await db.profile.toCollection().first();
  _currentLocale = profile?.locale ?? (navigator.language.startsWith('es') ? 'es' : 'en');
  _translations = await load_locale_file(_currentLocale);
}

/** Get the current locale */
export function get_locale(): Locale {
  return _currentLocale;
}

/** Switch locale at runtime */
export async function set_locale(locale: Locale): Promise<void> {
  _currentLocale = locale;
  _translations = await load_locale_file(locale);

  // Persist preference
  const profile = await db.profile.toCollection().first();
  if (profile?.id != null) {
    await db.profile.update(profile.id, { locale });
  }

  // Notify all listeners
  _listeners.forEach(fn => fn());
}

/** Subscribe to locale changes */
export function on_locale_change(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Translate a key with optional variable interpolation.
 * Variables use {name} syntax: t('insight.hydration', { delta: '12' })
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let text = _translations[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
