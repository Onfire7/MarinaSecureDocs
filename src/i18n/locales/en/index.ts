import { admin } from "./admin";
import { assets } from "./assets";
import { checklists } from "./checklists";
import { common } from "./common";
import { home } from "./home";
import { incidents } from "./incidents";
import { layout } from "./layout";
import { records } from "./records";
import { reports } from "./reports";
import { shared } from "./shared";
import { tickets } from "./tickets";

// English is the source of truth: a key exists when it is here. One
// namespace per area of src/pages/, plus `common`, `layout` (the shell) and
// `records` (what dataT stores).
const en = { admin, assets, checklists, common, home, incidents, layout, records, reports, shared, tickets };

export type Catalog = typeof en;
export default en;
