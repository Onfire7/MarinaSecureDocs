// Dates and numbers in the UI language (docs/localization.md § Catalogs).
//
// The language is read on every call rather than captured, so switching it
// takes effect on the next render with nothing to rebuild.

type When = Date | string | number;

export function makeFormatters(language: () => string) {
  return {
    date: (v: When, o?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleDateString(language(), o),
    time: (v: When, o?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleTimeString(language(), o),
    dateTime: (v: When, o?: Intl.DateTimeFormatOptions) => new Date(v).toLocaleString(language(), o),
    number: (n: number, o?: Intl.NumberFormatOptions) => n.toLocaleString(language(), o),
  };
}
