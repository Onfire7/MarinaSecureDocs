import { admin } from "./admin";
import { assets } from "./assets";
import { checklists } from "./checklists";
import { common } from "./common";
import { home } from "./home";
import { reports } from "./reports";

// English is the source of truth: a key exists when it is here. One
// namespace per area of src/pages/, plus `common`.
const en = { admin, assets, checklists, common, home, reports };

export type Catalog = typeof en;
export default en;
