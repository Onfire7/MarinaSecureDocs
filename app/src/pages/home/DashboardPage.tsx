import { useState } from "react";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  CARD_REGISTRY,
  defaultLayout,
  type CardDef,
  type LayoutEntry,
} from "./cards";

// Home — Dashboard (see pages/dashboard.html).
// Role-adaptive default card set; per-user show/hide/reorder persisted on
// User.dashboardLayout (null = derive from current roles).
export function DashboardPage() {
  const current = useCurrent();
  const [editing, setEditing] = useState(false);

  const roleNames = current.roleNames;
  const saved = current.user?.dashboardLayout ?? null;
  const layout: LayoutEntry[] = saved ?? defaultLayout(roleNames);

  const defById = new Map(CARD_REGISTRY.map((d) => [d.id, d]));

  // A card whose permission was revoked drops out automatically (and is not
  // auto-restored later — the user re-adds it or resets to defaults).
  const entries = layout
    .map((entry) => ({ entry, def: defById.get(entry.card as CardDef["id"]) }))
    .filter(
      (x): x is { entry: LayoutEntry; def: CardDef } =>
        x.def !== undefined && x.def.available(current),
    );

  const visibleEntries = entries.filter((x) => x.entry.visible);
  const inLayout = new Set(entries.map((x) => x.def.id));
  const addable = CARD_REGISTRY.filter(
    (d) => !inLayout.has(d.id) && d.available(current),
  );

  const persist = (next: LayoutEntry[] | null) => {
    if (!current.user) return;
    db.transact(
      db.tx.users[current.user.id].update({ dashboardLayout: next }),
    ).catch(console.error);
  };

  const move = (cardId: string, delta: -1 | 1) => {
    const next = [...layout];
    const idx = next.findIndex((e) => e.card === cardId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= next.length) return;
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    persist(next);
  };

  const setVisible = (cardId: string, visible: boolean) => {
    persist(layout.map((e) => (e.card === cardId ? { ...e, visible } : e)));
  };

  const addCard = (cardId: string) => {
    persist([...layout, { card: cardId, visible: true }]);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Home</h1>
          <div className="page-sub">{current.user?.name}</div>
        </div>
        <div className="row">
          {editing && (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => persist(null)}
              title="Discard saved layout and recompute from current roles"
            >
              Reset to role defaults
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Done" : "Edit layout"}
          </button>
        </div>
      </div>

      <div className="grid-cards">
        {(editing ? entries : visibleEntries).map(({ entry, def }, i, arr) => (
          <div
            key={def.id}
            className={"card" + (!entry.visible ? " card-hidden" : "")}
          >
            <div className="card-kicker">
              <span>{def.title}</span>
              {editing && (
                <span className="card-edit-controls">
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    disabled={i === 0}
                    onClick={() => move(def.id, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    disabled={i === arr.length - 1}
                    onClick={() => move(def.id, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => setVisible(def.id, !entry.visible)}
                  >
                    {entry.visible ? "Hide" : "Show"}
                  </button>
                </span>
              )}
            </div>
            <def.Component />
          </div>
        ))}

        {editing && addable.length > 0 && (
          <div className="card card-hidden">
            <div className="card-kicker">Add card</div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {addable.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => addCard(d.id)}
                >
                  + {d.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {visibleEntries.length === 0 && !editing && (
        <div className="placeholder">
          <div className="big">No cards on your dashboard</div>
          Use “Edit layout” to add cards you have access to.
        </div>
      )}
    </div>
  );
}
