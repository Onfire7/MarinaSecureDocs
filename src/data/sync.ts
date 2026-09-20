import { useEffect, useState } from "react";
import { db } from "../lib/db";

// The device's own upload queue.
//
// ps_crud is PowerSync's internal table of local writes not yet accepted by
// the office; a row leaves it only when uploadData() completes the
// transaction. It is polled rather than watched on purpose: watched queries
// resolve their tables through the app schema, which ps_crud is not part of,
// and a count that silently stopped updating is the one failure a save
// indicator cannot afford. A count(*) on a table this small costs nothing.

const POLL_MS = 1500;

export function useUploadQueue(): number {
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    let stopped = false;
    const read = () =>
      db
        .get<{ n: number }>("SELECT count(*) AS n FROM ps_crud")
        .then((r) => !stopped && setQueued(r.n))
        // Before init, or mid-close. The next tick will have it.
        .catch(() => {});
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    const dispose = db.registerListener({ statusChanged: () => void read() });
    return () => {
      stopped = true;
      clearInterval(timer);
      dispose();
    };
  }, []);
  return queued;
}
