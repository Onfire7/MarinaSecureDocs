import i18next, { type Module, type TFunction, type i18n } from "i18next";
import { KEYS_MODE } from "./resolveLanguage";

// The i18next instance and the two languages it serves (ADR 0009). Built by
// a factory, free of the browser, so the tests can make one with fixture
// catalogs; src/i18n/index.ts makes the app's.

/** i18next's own name for "render the key". */
const CIMODE = "cimode";

type Resources = Record<string, Record<string, object>>;

export interface Localizer {
  i18n: i18n;
  /** Switch the UI to a language, or to KEYS_MODE. */
  setUiLanguage(language: string): void;
  /** The marina's language, which `dataT` writes in. */
  setDataLanguage(language: string): void;
  /**
   * Translate into the marina's language, for text that is stored. Never
   * keys mode: a key written into the Activity Log would be there for good.
   */
  dataT: TFunction;
  /** The UI language as Intl understands it — English in keys mode. */
  uiLocale(): string;
}

export function createLocalizer(resources: Resources, uiLanguage: string, plugins: Module[] = []): Localizer {
  const instance = i18next.createInstance();
  for (const p of plugins) instance.use(p);
  void instance.init({
    resources,
    lng: uiLanguage === KEYS_MODE ? CIMODE : uiLanguage,
    fallbackLng: "en",
    ns: Object.keys(resources.en),
    defaultNS: "common",
    // Keys mode shows `namespace:key`, so a reviewer knows where to look.
    appendNamespaceToCIMode: true,
    // React escapes; escaping here too would show `&amp;`.
    interpolation: { escapeValue: false },
    // Catalogs are bundled, so there is nothing to wait for — and a
    // synchronous init means the first render is already in the right language.
    initAsync: false,
  });

  let dataLanguage = "en";
  // A forwarder rather than one fixed `t`, so a change of marina language
  // reaches every caller that already holds `dataT`. TFunction's overloads
  // cannot be spread through, hence the plain signature inside.
  type Forward = (...args: unknown[]) => string;
  const dataT = ((...args: unknown[]) =>
    (instance.getFixedT(dataLanguage) as unknown as Forward)(...args)) as unknown as TFunction;

  return {
    i18n: instance,
    setUiLanguage: (language) => void instance.changeLanguage(language === KEYS_MODE ? CIMODE : language),
    setDataLanguage: (language) => {
      dataLanguage = language in resources ? language : "en";
    },
    dataT,
    uiLocale: () => (instance.language === CIMODE ? "en" : instance.language),
  };
}
