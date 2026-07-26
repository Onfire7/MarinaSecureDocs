import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../lib/db";
import { formatNumber } from "../../lib/assets";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — Asset Categories & Maintenance Rules (see
// docs/pages/admin-assets.html). Categories aren't their own entity — just
// the set of Asset.category strings in use — so renaming one rewrites every
// asset carrying that label.
export function AdminAssetsPage() {
  return (
    <AdminGate requires="manage_assets">
      <AssetsAdmin />
    </AdminGate>
  );
}

type MaintenanceRule = { kind: "meter" | "time"; every: number; label?: string };

function AssetsAdmin() {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data } = db.useQuery({ assets: {} });
  const assets = useMemo(
    () =>
      [...(data?.assets ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [data],
  );

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) {
      if (a.category) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [assets]);

  const renameCategory = async (from: string) => {
    const to = renameValue.trim();
    if (!to) return;
    await db.transact(
      assets
        .filter((a) => a.category === from)
        .map((a) => db.tx.assets[a.id].update({ category: to })),
    );
    setRenaming(null);
  };

  const setRules = (assetId: string, rules: MaintenanceRule[]) =>
    void db.transact(db.tx.assets[assetId].update({ maintenanceRules: rules }));

  return (
    <div>
      <AdminHeader title="Asset Categories & Maintenance Rules" />

      <div className="grid-2">
        <div>
          <div className="section-title">Categories</div>
          <div className="stack" style={{ gap: 6 }}>
            {categories.map(([name, count]) => (
              <div key={name} className="card spread">
                {renaming === name ? (
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
                      onClick={() => void renameCategory(name)}
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
                  <>
                    <span>
                      {name}
                      <span className="muted small">
                        {" "}
                        · {count} asset{count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => {
                        setRenaming(name);
                        setRenameValue(name);
                      }}
                    >
                      Rename
                    </button>
                  </>
                )}
              </div>
            ))}
            {categories.length === 0 && (
              <span className="muted small">
                No categories in use — set one on an asset from the Assets page.
              </span>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Categories are the labels currently on assets; a new one comes into
            existence the moment an asset uses it.
          </p>
        </div>

        <div>
          <div className="section-title">Maintenance rules, per asset</div>
          <div className="stack" style={{ gap: 6 }}>
            {assets.map((a) => {
              const rules = (a.maintenanceRules ?? []) as MaintenanceRule[];
              const open = expanded === a.id;
              return (
                <div key={a.id} className="card">
                  <div className="spread">
                    <div>
                      <Link to={`/assets/${a.id}`} className="card-title">
                        {a.name}
                      </Link>
                      <div className="card-meta">
                        {rules.length} rule{rules.length === 1 ? "" : "s"} ·{" "}
                        {a.hasMeter
                          ? `${a.meterType === "mileage" ? "mileage" : "hours"} meter`
                          : "meterless"}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() => setExpanded(open ? null : a.id)}
                    >
                      {open ? "Done" : "Edit rules"}
                    </button>
                  </div>

                  {open && (
                    <RuleEditor
                      hasMeter={a.hasMeter}
                      meterType={a.meterType}
                      rules={rules}
                      onChange={(next) => setRules(a.id, next)}
                    />
                  )}
                </div>
              );
            })}
            {assets.length === 0 && (
              <span className="muted small">No assets yet.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleEditor({
  hasMeter,
  meterType,
  rules,
  onChange,
}: {
  hasMeter: boolean;
  meterType?: string | null;
  rules: MaintenanceRule[];
  onChange: (rules: MaintenanceRule[]) => void;
}) {
  // A meterless asset can only carry time-based rules — meter-based isn't
  // offered at all rather than offered and rejected.
  const [kind, setKind] = useState<"meter" | "time">(hasMeter ? "meter" : "time");
  const [every, setEvery] = useState("");
  const [label, setLabel] = useState("");

  const unit = kind === "time" ? "days" : meterType === "mileage" ? "mi" : "hrs";

  const add = () => {
    const n = Number(every);
    if (!n || n <= 0) return;
    onChange([...rules, { kind, every: n, label: label.trim() || undefined }]);
    setEvery("");
    setLabel("");
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div className="stack" style={{ gap: 4, marginBottom: 8 }}>
        {rules.map((r, i) => (
          <div key={i} className="card spread small">
            <span>
              {r.label ? `${r.label} — ` : ""}
              every {formatNumber(r.every)}{" "}
              {r.kind === "time" ? "days" : meterType === "mileage" ? "mi" : "hrs"}
              <span className="muted"> ({r.kind}-based)</span>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => onChange(rules.filter((_, x) => x !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        {rules.length === 0 && (
          <span className="muted small">No rules — never auto-generates tickets.</span>
        )}
      </div>

      <div className="row" style={{ flexWrap: "wrap" }}>
        {hasMeter && (
          <select
            className="select select-inline"
            value={kind}
            onChange={(e) => setKind(e.target.value as "meter" | "time")}
          >
            <option value="meter">Meter-based</option>
            <option value="time">Time-based</option>
          </select>
        )}
        <span className="small muted">every</span>
        <input
          type="number"
          className="input select-inline"
          style={{ width: 90 }}
          value={every}
          onChange={(e) => setEvery(e.target.value)}
        />
        <span className="small muted">{unit}</span>
        <input
          className="input select-inline"
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={!Number(every)}
          onClick={add}
        >
          Add rule
        </button>
      </div>
    </div>
  );
}
