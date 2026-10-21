// Which language the UI speaks (docs/localization.md § Two languages).
// Pure, so the order is unit-tested rather than discovered on a phone.

/** The UI "language" that renders catalog keys instead of copy. */
export const KEYS_MODE = "keys";

/**
 * The shape the database accepts for `users.language` and
 * `marina_settings.language`. Whether a code is *available* is a different
 * question — it is when src/i18n/locales/ has a catalog for it.
 */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function isLanguageCode(code: string): boolean {
  return LANGUAGE_CODE.test(code);
}

/** The available language for `code`: exact, else its base (`es-MX` → `es`). */
export function matchLanguage(code: string, available: readonly string[]): string | null {
  if (available.includes(code)) return code;
  const base = code.split("-")[0];
  return available.includes(base) ? base : null;
}

export interface LanguageInputs {
  keysMode: boolean;
  /**
   * The user's `language`: a code, null for "follow the device", or
   * undefined while the user row has not loaded.
   */
  user: string | null | undefined;
  /** The last language this device used, from localStorage. */
  device: string | null;
  /** `navigator.languages`, most preferred first. */
  navigator: readonly string[];
  available: readonly string[];
}

export function resolveUiLanguage(i: LanguageInputs): string {
  if (i.keysMode) return KEYS_MODE;
  // The device cache only bridges the gap before the user row arrives (the
  // sign-in screen, the first paint before sync). After that it would hand
  // one person's language to the next person on a shared phone.
  const candidates = [
    i.user,
    i.user === undefined ? i.device : null,
    ...i.navigator,
  ];
  for (const c of candidates) {
    const match = c ? matchLanguage(c, i.available) : null;
    if (match) return match;
  }
  return "en";
}

/**
 * Keys mode after reading `?lng=`: `keys` turns it on, any other value
 * (including empty) turns it off, and no parameter leaves it as stored.
 */
export function keysModeAfterQuery(query: string | null, stored: boolean): boolean {
  if (query === null) return stored;
  return query === KEYS_MODE;
}
