import { useMemo, useState } from "react";
import {
  SUBJECT_LABELS,
  VERBS,
  describeRule,
  type AuditKind,
  type Condition,
  type Resolution,
  type RuleLocation,
  type Subject,
  type Target,
} from "../../lib/auditRules";
import {
  allDraftQuestions,
  findDraftRule,
  newDraftQuestion,
  newDraftRule,
  pathToDraftRule,
  removeDraftRule,
  resolveDraft,
  updateDraftRule,
  type DraftQuestion,
  type DraftRule,
  type QuestionKind,
} from "../../data/audits";
import { useRuleLocations } from "../../data/audits";
import { useAmenities, useServices } from "../../data/services";
import { useLocationStatuses } from "../../data/lookups";
import { useLocationTypes } from "../../data/locations";
import { useIsMobile } from "../../hooks/useIsMobile";
import { LocationPicker } from "../shared/LocationPicker";
import { compareNames } from "../../lib/locations";

// The Audit Template rule-tree editor — docs/audits.md § The template editor.
//
// Settled by prototype (branch prototype/audit-rules): above the mobile
// breakpoint the whole tree is an OUTLINE of nested cards with the live
// preview in a sticky column; below it, ONE RULE PER SCREEN behind a
// breadcrumb that reads as the narrowing story. Both share the model, the
// condition editor (subject · verb · value sentences), and the preview.
// Every rule has a colour; preview rows carry a dot per rule that selected
// them. Desktop hovers in both directions; phones have no hover and get
// the dots plus the rule list as legend.

const PALETTE = ["#2f6f9f", "#c2410c", "#15803d", "#7c3aed", "#b45309", "#0e7490", "#be185d", "#4d7c0f"];

export interface EditorContext {
  kind: AuditKind;
  locations: RuleLocation[];
  byId: Map<string, RuleLocation>;
  typeNames: string[];
  statusNames: string[];
  services: { id: string; name: string }[];
  amenities: { id: string; name: string }[];
  /** Locations with children — the candidates for "is under". */
  containers: { id: string; name: string; parent_id: string | null }[];
  colors: Map<string, { color: string; depth: number }>;
}

/** Everything the editor needs from the marina, gathered once. */
export function useEditorContext(kind: AuditKind, roots: DraftRule[]): EditorContext {
  const locations = useRuleLocations();
  const { data: types } = useLocationTypes();
  const { statuses } = useLocationStatuses();
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  return useMemo(() => {
    const live = locations.filter((l) => !l.retired);
    const parents = new Set(live.map((l) => l.parentId).filter((p): p is string => !!p));
    const colors = new Map<string, { color: string; depth: number }>();
    let i = 0;
    const walk = (r: DraftRule, depth: number) => {
      colors.set(r.id, { color: PALETTE[i++ % PALETTE.length], depth });
      r.children.forEach((c) => walk(c, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    return {
      kind,
      locations: live,
      byId: new Map(live.map((l) => [l.id, l])),
      typeNames: types.map((t) => t.name),
      statusNames: statuses.map((s) => s.name),
      services,
      amenities,
      containers: live
        .filter((l) => parents.has(l.id))
        .map((l) => ({ id: l.id, name: l.name, parent_id: l.parentId }))
        .sort((a, b) => compareNames(a.name, b.name)),
      colors,
    };
  }, [kind, locations, types, statuses, services, amenities, roots]);
}

export function useResolution(roots: DraftRule[], ctx: EditorContext): Resolution {
  return useMemo(() => resolveDraft(roots, ctx.locations, ctx.kind), [roots, ctx]);
}

function describe(rule: DraftRule, ctx: EditorContext): string {
  return describeRule(
    { id: rule.id, mode: rule.mode, conditions: rule.conditions, questionIds: [], children: [] },
    (id) => ctx.byId.get(id)?.name ?? "?",
  );
}

// ── shared pieces ────────────────────────────────────────────────────────

export function RuleDot({
  rule,
  ctx,
  onHover,
}: {
  rule: DraftRule;
  ctx: EditorContext;
  onHover?: (id: string | null) => void;
}) {
  const color = ctx.colors.get(rule.id)?.color ?? "var(--mute)";
  return (
    <span
      title={describe(rule, ctx)}
      onMouseOver={
        onHover
          ? (e) => {
              e.stopPropagation();
              onHover(rule.id);
            }
          : undefined
      }
      onMouseOut={
        onHover
          ? (e) => {
              e.stopPropagation();
              onHover(null);
            }
          : undefined
      }
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        borderRadius: 999,
        background: color,
        marginRight: 6,
        verticalAlign: "middle",
        flexShrink: 0,
        cursor: onHover ? "pointer" : undefined,
      }}
    />
  );
}

function ValueInput({
  c,
  ctx,
  onChange,
}: {
  c: Condition;
  ctx: EditorContext;
  onChange: (v: string) => void;
}) {
  const verb = VERBS[c.subject].find((v) => v.key === c.verb);
  if (!verb?.needsValue) return null;
  const sel = (opts: { id: string; label: string }[]) => (
    <select className="select select-inline" value={c.value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
  switch (c.subject) {
    case "type":
      return sel(ctx.typeNames.map((n) => ({ id: n, label: n })));
    case "status":
      return sel(ctx.statusNames.map((n) => ({ id: n, label: n })));
    case "service":
      return sel(ctx.services.map((s) => ({ id: s.id, label: s.name })));
    case "amenity":
      return sel(ctx.amenities.map((a) => ({ id: a.id, label: a.name })));
    case "location":
      // A search picker, not a native select: a marina has hundreds of containers.
      return (
        <div style={{ minWidth: 200, flex: 1 }}>
          <LocationPicker
            locations={ctx.containers}
            value={c.value}
            onChange={onChange}
            allowNone={false}
            placeholder="Search a dock, building…"
          />
        </div>
      );
    case "last_audited":
      return <input className="input select-inline" type="date" value={c.value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return (
        <input
          className="input select-inline"
          value={c.value}
          placeholder="text"
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 110 }}
        />
      );
  }
}

/** Conditions as sentences. Rows after the first start with the and/or toggle. */
export function ConditionEditor({
  rule,
  ctx,
  onChange,
}: {
  rule: DraftRule;
  ctx: EditorContext;
  onChange: (r: DraftRule) => void;
}) {
  const setAt = (i: number, patch: Partial<Condition>) =>
    onChange({ ...rule, conditions: rule.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rule.conditions.map((c, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {i > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => onChange({ ...rule, mode: rule.mode === "all" ? "any" : "all" })}
              title="Toggle: every condition must hold, or any one"
            >
              {rule.mode === "all" ? "and" : "or"}
            </button>
          )}
          <select
            className="select select-inline"
            value={c.subject}
            onChange={(e) => {
              const subject = e.target.value as Subject;
              setAt(i, { subject, verb: VERBS[subject][0].key, value: "" });
            }}
          >
            {(Object.keys(SUBJECT_LABELS) as Subject[]).map((s) => (
              <option key={s} value={s}>
                {SUBJECT_LABELS[s]}
              </option>
            ))}
          </select>
          <select className="select select-inline" value={c.verb} onChange={(e) => setAt(i, { verb: e.target.value })}>
            {VERBS[c.subject].map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
          <ValueInput c={c} ctx={ctx} onChange={(v) => setAt(i, { value: v })} />
          <button
            type="button"
            className="btn btn-sm btn-bare"
            aria-label="Remove condition"
            onClick={() => onChange({ ...rule, conditions: rule.conditions.filter((_, j) => j !== i) })}
          >
            ✕
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            onChange({ ...rule, conditions: [...rule.conditions, { subject: "name", verb: "contains", value: "" }] })
          }
        >
          + condition
        </button>
      </div>
    </div>
  );
}

const QUESTION_KINDS: { key: QuestionKind; label: string }[] = [
  { key: "yes_no", label: "Yes / No" },
  { key: "choice", label: "Choice" },
  { key: "text", label: "Text" },
  { key: "meter_reading", label: "Meter reading" },
];

export function QuestionEditor({
  rule,
  ctx,
  onChange,
}: {
  rule: DraftRule;
  ctx: EditorContext;
  onChange: (r: DraftRule) => void;
}) {
  const [draft, setDraft] = useState("");
  const setQ = (id: string, patch: Partial<DraftQuestion>) =>
    onChange({ ...rule, questions: rule.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  const add = () => {
    if (!draft.trim()) return;
    onChange({ ...rule, questions: [...rule.questions, newDraftQuestion(draft.trim())] });
    setDraft("");
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rule.questions.map((q) => (
        <div key={q.id} className="card" style={{ padding: "8px 10px" }}>
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <input
              className="input"
              value={q.prompt}
              onChange={(e) => setQ(q.id, { prompt: e.target.value })}
              style={{ flex: 1 }}
            />
            <select
              className="select select-inline"
              value={q.kind}
              onChange={(e) => setQ(q.id, { kind: e.target.value as QuestionKind })}
            >
              {QUESTION_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-bare"
              aria-label="Remove question"
              onClick={() => onChange({ ...rule, questions: rule.questions.filter((x) => x.id !== q.id) })}
            >
              ✕
            </button>
          </div>
          {q.kind === "yes_no" && (
            <label className="muted small" style={{ display: "block", marginTop: 4 }}>
              <input type="checkbox" checked={q.ticketOnNo} onChange={(e) => setQ(q.id, { ticketOnNo: e.target.checked })} />{" "}
              raise a Ticket when the answer is No
            </label>
          )}
          {q.kind === "choice" && (
            <input
              className="input"
              style={{ marginTop: 4 }}
              placeholder="Choices, comma-separated"
              value={q.choices.join(", ")}
              onChange={(e) => setQ(q.id, { choices: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          )}
          {q.kind === "meter_reading" && (
            <select
              className="select select-inline"
              style={{ marginTop: 4 }}
              value={q.serviceId ?? ""}
              onChange={(e) => setQ(q.id, { serviceId: e.target.value || null })}
            >
              <option value="">Which metered service?</option>
              {ctx.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          value={draft}
          placeholder="Ask these locations…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!draft.trim()}>
          + question
        </button>
      </div>
    </div>
  );
}

/** The live preview: every target, with a dot per rule that selected it. */
export function TargetPreview({
  res,
  roots,
  ctx,
  highlight,
  onHoverRule,
  limit = 80,
}: {
  res: Resolution;
  roots: DraftRule[];
  ctx: EditorContext;
  highlight?: string | null;
  onHoverRule?: (id: string | null) => void;
  limit?: number;
}) {
  const showRoot = roots.length > 1;
  const questionCount = (t: Target) => t.questionIds.length;
  return (
    <div>
      <div className="card-kicker">
        <span>{res.targets.length} target locations</span>
        <span>{res.targets.reduce((n, t) => n + questionCount(t), 0)} question asks</span>
      </div>
      {res.targets.length === 0 && <div className="muted small">Nothing selected yet.</div>}
      {res.targets.slice(0, limit).map((t) => {
        const loc = ctx.byId.get(t.locationId);
        const dim = highlight && !t.ruleIds.includes(highlight);
        const rules = t.ruleIds
          .map((id) => findDraftRule(roots, id))
          .filter((r): r is DraftRule => !!r && (showRoot || (ctx.colors.get(r.id)?.depth ?? 0) > 0));
        return (
          <div
            key={t.locationId}
            className="row"
            style={{
              padding: "4px 0",
              borderBottom: "1px solid var(--line-lt)",
              opacity: dim ? 0.35 : 1,
              alignItems: "center",
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{loc?.name}</b>{" "}
              <span className="muted small">
                {loc?.typeName} · {loc?.statusName ?? "no status"}
              </span>
            </span>
            <span style={{ display: "flex", gap: 2 }}>
              {rules.map((r) => (
                <RuleDot key={r.id} rule={r} ctx={ctx} onHover={onHoverRule} />
              ))}
            </span>
            <span className="muted small" style={{ width: 28, textAlign: "right" }}>
              {questionCount(t) ? `+${questionCount(t)}` : ""}
            </span>
          </div>
        );
      })}
      {res.targets.length > limit && <div className="muted small">…and {res.targets.length - limit} more</div>}
    </div>
  );
}

// ── the two layouts ──────────────────────────────────────────────────────

function staysLit(rule: DraftRule, pointedId: string, roots: DraftRule[]): boolean {
  return (
    pathToDraftRule(roots, rule.id).some((r) => r.id === pointedId) ||
    pathToDraftRule(roots, pointedId).some((r) => r.id === rule.id)
  );
}

function OutlineCard({
  rule,
  depth,
  parentCount,
  ctx,
  res,
  roots,
  setRoots,
  onHover,
  pointed,
}: {
  rule: DraftRule;
  depth: number;
  parentCount: number;
  ctx: EditorContext;
  res: Resolution;
  roots: DraftRule[];
  setRoots: (r: DraftRule[]) => void;
  onHover: (id: string | null) => void;
  pointed: string | null;
}) {
  const count = res.selected.get(rule.id)?.size ?? 0;
  const set = (r: DraftRule) => setRoots(updateDraftRule(roots, rule.id, () => r));
  const color = ctx.colors.get(rule.id)?.color;
  const isPointed = pointed === rule.id;
  return (
    <div
      className="card"
      style={{
        marginLeft: depth === 0 ? 0 : 18,
        borderLeft: `4px solid ${color}`,
        marginBottom: 10,
        opacity: pointed && !staysLit(rule, pointed, roots) ? 0.4 : 1,
        boxShadow: isPointed ? `0 0 0 3px ${color}` : undefined,
        transition: "opacity 120ms, box-shadow 120ms",
      }}
      onMouseOver={(e) => {
        e.stopPropagation();
        onHover(rule.id);
      }}
      onMouseOut={(e) => {
        e.stopPropagation();
        onHover(null);
      }}
    >
      <div className="card-kicker">
        <span>
          {depth === 0 ? "Rule" : "Narrows to"} · <b>{count}</b>
          {depth > 0 && <span> of {parentCount}</span>}
        </span>
        <button type="button" className="btn btn-sm btn-bare" onClick={() => setRoots(removeDraftRule(roots, rule.id))}>
          remove
        </button>
      </div>
      <div className="card-title" style={{ marginBottom: 8 }}>
        <RuleDot rule={rule} ctx={ctx} />
        {describe(rule, ctx)}
      </div>
      <ConditionEditor rule={rule} ctx={ctx} onChange={set} />
      <div className="section-title" style={{ marginTop: 10 }}>
        Questions for these {count}
      </div>
      <QuestionEditor rule={rule} ctx={ctx} onChange={set} />
      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-sm" onClick={() => set({ ...rule, children: [...rule.children, newDraftRule()] })}>
          + narrow further
        </button>
      </div>
      {rule.children.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {rule.children.map((c) => (
            <OutlineCard
              key={c.id}
              rule={c}
              depth={depth + 1}
              parentCount={count}
              ctx={ctx}
              res={res}
              roots={roots}
              setRoots={setRoots}
              onHover={onHover}
              pointed={pointed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Outline({
  roots,
  setRoots,
  ctx,
  res,
}: {
  roots: DraftRule[];
  setRoots: (r: DraftRule[]) => void;
  ctx: EditorContext;
  res: Resolution;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [pointed, setPointed] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
      <div>
        {roots.map((r) => (
          <OutlineCard
            key={r.id}
            rule={r}
            depth={0}
            parentCount={ctx.locations.length}
            ctx={ctx}
            res={res}
            roots={roots}
            setRoots={setRoots}
            onHover={setHover}
            pointed={pointed}
          />
        ))}
        <button type="button" className="btn" onClick={() => setRoots([...roots, newDraftRule()])}>
          + rule
        </button>
      </div>
      <div className="card" style={{ position: "sticky", top: 12, maxHeight: "80vh", overflow: "auto" }}>
        <div className="muted small" style={{ marginBottom: 6 }}>
          {hover
            ? `Showing what “${describe(findDraftRule(roots, hover)!, ctx)}” selects`
            : "Hover a rule to see what it selects"}
        </div>
        <TargetPreview res={res} roots={roots} ctx={ctx} highlight={hover} onHoverRule={setPointed} />
      </div>
    </div>
  );
}

function DrillDown({
  roots,
  setRoots,
  ctx,
  res,
}: {
  roots: DraftRule[];
  setRoots: (r: DraftRule[]) => void;
  ctx: EditorContext;
  res: Resolution;
}) {
  const [currentId, setCurrentId] = useState<string | null>(roots[0]?.id ?? null);
  const path = currentId ? pathToDraftRule(roots, currentId) : [];
  const rule = path[path.length - 1];
  const countOf = (r: DraftRule) => res.selected.get(r.id)?.size ?? 0;

  // Past three levels the breadcrumb collapses its middle.
  const crumbPath = path.length > 3 ? [path[0], null, path[path.length - 1]] : path;
  const crumbs = (
    <div className="chip-row" style={{ marginBottom: 12 }}>
      <button type="button" className={`chip ${!rule ? "tree-match" : ""}`} onClick={() => setCurrentId(null)}>
        All · {ctx.locations.length}
      </button>
      {crumbPath.map((r, i) =>
        r === null ? (
          <span key="ellipsis" style={{ display: "contents" }}>
            <span className="muted">›</span>
            <button type="button" className="chip" onClick={() => setCurrentId(path[path.length - 2].id)}>
              …
            </button>
          </span>
        ) : (
          <span key={r.id} style={{ display: "contents" }}>
            <span className="muted">›</span>
            <button
              type="button"
              className={`chip ${i === crumbPath.length - 1 ? "tree-match" : ""}`}
              onClick={() => setCurrentId(r.id)}
            >
              <RuleDot rule={r} ctx={ctx} />
              {describe(r, ctx)} · {countOf(r)}
            </button>
          </span>
        ),
      )}
    </div>
  );

  const ruleRow = (r: DraftRule, parentCount: number) => (
    <button
      key={r.id}
      type="button"
      className="card tree-head"
      style={{ marginBottom: 8, display: "block", borderLeft: `4px solid ${ctx.colors.get(r.id)?.color}` }}
      onClick={() => setCurrentId(r.id)}
    >
      <div className="card-title">
        <RuleDot rule={r} ctx={ctx} />
        {describe(r, ctx)}
      </div>
      <div className="card-meta">
        {countOf(r)} of {parentCount} · {r.questions.length} question{r.questions.length === 1 ? "" : "s"}
        {r.children.length > 0 ? ` · ${r.children.length} narrower ›` : " ›"}
      </div>
    </button>
  );

  if (!rule) {
    return (
      <div>
        {crumbs}
        <div className="section-title">Rules</div>
        {roots.map((r) => ruleRow(r, ctx.locations.length))}
        <button
          type="button"
          className="btn"
          onClick={() => {
            const r = newDraftRule();
            setRoots([...roots, r]);
            setCurrentId(r.id);
          }}
        >
          + rule
        </button>
        <div className="card" style={{ marginTop: 16 }}>
          <TargetPreview res={res} roots={roots} ctx={ctx} limit={40} />
        </div>
      </div>
    );
  }

  const parentCount = path.length > 1 ? countOf(path[path.length - 2]) : ctx.locations.length;
  const set = (r: DraftRule) => setRoots(updateDraftRule(roots, rule.id, () => r));
  return (
    <div>
      {crumbs}
      <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${ctx.colors.get(rule.id)?.color}` }}>
        <div className="card-kicker">
          <span>
            <RuleDot rule={rule} ctx={ctx} />
            Selects <b>{countOf(rule)}</b> of {parentCount}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-bare"
            onClick={() => {
              setCurrentId(path.length > 1 ? path[path.length - 2].id : null);
              setRoots(removeDraftRule(roots, rule.id));
            }}
          >
            remove rule
          </button>
        </div>
        <ConditionEditor rule={rule} ctx={ctx} onChange={set} />
      </div>
      <div className="section-title">Ask these {countOf(rule)}</div>
      <div className="card" style={{ marginBottom: 12 }}>
        <QuestionEditor rule={rule} ctx={ctx} onChange={set} />
      </div>
      <div className="section-title">Narrow further</div>
      {rule.children.map((c) => ruleRow(c, countOf(rule)))}
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          const c = newDraftRule();
          set({ ...rule, children: [...rule.children, c] });
          setCurrentId(c.id);
        }}
      >
        + narrower rule
      </button>
      <div className="card" style={{ marginTop: 16 }}>
        <TargetPreview res={res} roots={roots} ctx={ctx} limit={40} />
      </div>
    </div>
  );
}

/** The editor: one model, two layouts by width. */
export function RuleTreeEditor({
  roots,
  onChange,
  ctx,
  res,
}: {
  roots: DraftRule[];
  onChange: (roots: DraftRule[]) => void;
  ctx: EditorContext;
  res: Resolution;
}) {
  const mobile = useIsMobile();
  return mobile ? (
    <DrillDown roots={roots} setRoots={onChange} ctx={ctx} res={res} />
  ) : (
    <Outline roots={roots} setRoots={onChange} ctx={ctx} res={res} />
  );
}

export function questionCountOf(roots: DraftRule[]): number {
  return allDraftQuestions(roots).length;
}
