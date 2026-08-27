import { useState } from "react";
import {
  createIncidentType,
  deleteIncidentType,
  mergeIncidentTypes,
  renameIncidentType,
  useIncidentTypes,
} from "../../data/lookups";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — Incident Types (see docs/pages/admin-incident-types.html).
// Gated by create_incidents, the same permission that allows inline type
// creation from the New Incident form. This screen exists mainly for cleanup:
// renaming, merging near-duplicates, removing unused types.
export function AdminIncidentTypesPage() {
  return (
    <AdminGate requires="create_incidents">
      <IncidentTypes />
    </AdminGate>
  );
}

function IncidentTypes() {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");

  const { types } = useIncidentTypes();

  const add = async () => {
    if (!newName.trim()) return;
    await createIncidentType(newName.trim());
    setNewName("");
  };

  const rename = async (typeId: string) => {
    if (!renameValue.trim()) return;
    // A live reference, so existing incidents show the new name automatically.
    await renameIncidentType(typeId, renameValue.trim());
    setRenaming(null);
  };

  // Re-point every incident on the source type to the target, then remove the
  // source — the safe path to removing a type that's still in use. The
  // re-point happens in the database rather than one write per incident,
  // which also means it covers incidents this device does not hold.
  const merge = async (sourceId: string) => {
    if (!mergeTarget) return;
    await mergeIncidentTypes(sourceId, mergeTarget);
    setMergeSource(null);
    setMergeTarget("");
  };

  return (
    <div>
      <AdminHeader title="Incident Types" />

      <div className="row" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="New type name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!newName.trim()}
          onClick={() => void add()}
        >
          Add type
        </button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {types.map((t) => {
          const usage = t.usage;
          const inUse = usage > 0;
          return (
            <div key={t.id} className="card">
              <div className="spread" style={{ flexWrap: "wrap" }}>
                {renaming === t.id ? (
                  <div className="row">
                    <input
                      className="input select-inline"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => void rename(t.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => setRenaming(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div>
                    <span className="card-title">{t.name}</span>
                    <span className="muted small">
                      {" "}
                      · used by {usage} incident{usage === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
                {renaming !== t.id && (
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => {
                        setRenaming(t.id);
                        setRenameValue(t.name);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => {
                        setMergeSource(mergeSource === t.id ? null : t.id);
                        setMergeTarget("");
                      }}
                    >
                      Merge
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      // Deleting a type still in use would orphan those
                      // incidents; merge is the offered path instead.
                      disabled={inUse}
                      title={inUse ? "In use — merge it instead" : undefined}
                      onClick={() => void deleteIncidentType(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              {mergeSource === t.id && (
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="small muted">Move its incidents into</span>
                  <select
                    className="select select-inline"
                    value={mergeTarget}
                    onChange={(e) => setMergeTarget(e.target.value)}
                  >
                    <option value="">Select a type…</option>
                    {types
                      .filter((o) => o.id !== t.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={!mergeTarget}
                    onClick={() => void merge(t.id)}
                  >
                    Merge &amp; remove "{t.name}"
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {types.length === 0 && (
          <div className="placeholder">
            <div className="big">No incident types yet</div>
            Types also get created inline when someone logs an incident.
          </div>
        )}
      </div>
    </div>
  );
}
