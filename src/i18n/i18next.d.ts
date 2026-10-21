import type { Catalog } from "./locales/en";

// Types every `t()` call against the English catalog: a mistyped key, or one
// that does not exist yet, fails `tsc -b`.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: Catalog;
  }
}
