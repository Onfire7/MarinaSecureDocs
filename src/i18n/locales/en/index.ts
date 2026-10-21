import { admin } from "./admin";
import { common } from "./common";

// English is the source of truth: a key exists when it is here. One
// namespace per area of src/pages/, plus `common`.
const en = { admin, common };

export type Catalog = typeof en;
export default en;
