import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { dateTime, time } from "../../i18n";
import { formatDuration } from "../../lib/shiftReport";
import { summaryFacts, worstMark, type LocationCard, type RecordItem, type ShiftReportDoc, type Since, type SinceRow } from "../../lib/shiftReportDoc";
import { describeUpdate } from "../../lib/recordHistory";
import { VehicleUseList } from "./VehicleUseList";

// The Shift Report's view (ShiftReportPage.spec.md § The document): Variant D
// of prototype/shift-report. Three pages mount it: the End of Shift review,
// the in-app page, and the public Report Link. It renders the document and
// what moved since; it imports nothing that reaches Clerk, PowerSync or the
// app's database (src/lib/publicBundle.test.ts).

export interface SinceMap {
  incidents: Record<string, Since>;
  tickets: Record<string, Since>;
}

export function ShiftReportView({
  doc,
  since,
  inApp,
  banner,
  afterHeader,
}: {
  doc: ShiftReportDoc;
  since: SinceMap | null;
  /** Record names link to their pages; the review's attention lines link to their checklists. */
  inApp: boolean;
  banner?: ReactNode;
  /** The review's End of Shift Note box. */
  afterHeader?: ReactNode;
}) {
  const { t } = useTranslation("reports");
  const stamp = (iso: string) => dateTime(iso, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const hm = (iso: string) => time(iso, { hour: "numeric", minute: "2-digit" });
  const window = { start: Date.parse(doc.shift.startedAt), end: doc.shift.endedAt ? Date.parse(doc.shift.endedAt) : Date.now() };

  return (
    <div className="report" data-testid="shift-report">
      {banner}
      <div className="report-letterhead">
        <div>
          <div className="report-kicker">{t("report.kicker", { marina: doc.marinaName })}</div>
          <h1>{doc.shift.guardName}</h1>
          <div className="muted">
            {doc.shift.endedAt
              ? t("report.span", { start: stamp(doc.shift.startedAt), end: stamp(doc.shift.endedAt), duration: formatDuration(window) })
              : t("report.spanOpen", { start: stamp(doc.shift.startedAt), duration: formatDuration(window) })}
          </div>
        </div>
        <div className="report-letterhead-right muted small">
          {doc.shift.endedBy?.kind === "checklist" && <div>{t("report.endedByChecklist", { name: doc.shift.endedBy.name })}</div>}
          {doc.shift.endedBy?.kind === "button" && <div>{t("report.endedByButton")}</div>}
          {doc.shift.endedAt && <div>{t("report.endOfShiftAt", { when: stamp(doc.shift.endedAt) })}</div>}
        </div>
      </div>

      {afterHeader}

      {doc.note && (
        <>
          <h2>{t("report.note")}</h2>
          <blockquote className="ps-eos" data-testid="report-note">{doc.note}</blockquote>
        </>
      )}

      <h2>{t("report.summary")}</h2>
      <div className="report-prose" data-testid="report-summary">
        {summaryFacts(doc).map((p, i) => (
          <p key={p.key + i} className={i === 0 ? "lede" : undefined}>
            {t(`summary.${p.key}` as "summary.attention", p.values as { count: number })}
          </p>
        ))}
      </div>
      <div className="ps-checklists">
        {doc.checklists.map((c) => (
          <span key={c.id} className={`ps-chip ${c.done < c.total ? "ps-chip-bad" : ""}`}>
            {t("report.chip", { name: c.name, done: c.done, total: c.total })}
            {c.completedAt ? ` · ${hm(c.completedAt)}` : c.dueBy ? ` · ${t("report.due", { time: hm(c.dueBy) })}` : ""}
            {c.previousShiftItems > 0 && ` · ${t("report.previousShiftItems", { count: c.previousShiftItems })}`}
          </span>
        ))}
      </div>

      <h2>{t("report.attention", { count: doc.attention.length })}</h2>
      {doc.attention.length === 0 ? (
        <p className="muted">{t("report.nothingNeedsAttention")}</p>
      ) : (
        <ul className="ps-attn" data-testid="report-attention">
          {doc.attention.map((a, i) => {
            const text = t(`attention.${a.kind}` as "attention.incident", a.values as { title: string });
            return (
              <li key={i} className={`ps-attn-${a.tone}`}>
                <span className="ps-attn-where">{a.where}</span>
                <span>{inApp && a.checklistId ? <Link to={`/checklists/${a.checklistId}`}>{text}</Link> : text}</span>
                <span className="muted small">{a.at ? hm(a.at) : ""}</span>
              </li>
            );
          })}
        </ul>
      )}

      <h2>{t("report.incidents", { count: doc.incidents.length })}</h2>
      {doc.incidents.length === 0 && <p className="muted">{t("report.none")}</p>}
      {doc.incidents.map((i) => (
        <article key={i.id} className="psd-doc" id={`incident-${i.id}`}>
          <div className="psd-orig">
            <div className="report-kicker">{t("report.atEndOfShift", { status: i.status })}</div>
            <strong>{inApp ? <Link to={`/incidents/${i.id}`}>{i.title}</Link> : i.title}</strong>
            <div className="muted small">
              {[i.typeName, i.targetLabel, hm(i.createdAt)].filter(Boolean).join(" · ")}
            </div>
            {i.details && <p style={{ whiteSpace: "pre-wrap" }}>{i.details}</p>}
            <Photos srcs={i.photos} />
          </div>
          {since && <SincePanel handedIn={i.status} since={since.incidents[i.id]} hm={stamp} />}
        </article>
      ))}

      <h2>{t("report.tickets", { count: doc.tickets.length })}</h2>
      {doc.tickets.length === 0 && <p className="muted">{t("report.none")}</p>}
      {doc.tickets.map((k) => (
        <article key={k.id} className="psd-doc" id={`ticket-${k.id}`}>
          <div className="psd-orig">
            <div className="report-kicker">
              {t("report.atEndOfShiftTicket", { status: k.status, priority: k.priority, assignee: k.assignee ?? t("report.unassigned") })}
            </div>
            <strong>{inApp ? <Link to={`/tickets/${k.id}`}>{k.title}</Link> : k.title}</strong>
            <div className="muted small">
              {[k.targetLabel, hm(k.createdAt), k.origin ? t("report.from", { origin: k.origin }) : null].filter(Boolean).join(" · ")}
            </div>
            {k.description && <p style={{ whiteSpace: "pre-wrap" }}>{k.description}</p>}
            <Photos srcs={k.photos} />
          </div>
          {since && <SincePanel handedIn={k.status} since={since.tickets[k.id]} hm={stamp} />}
        </article>
      ))}

      <h2>{t("report.notes", { count: doc.notes.length })}</h2>
      {doc.notes.length === 0 && <p className="muted">{t("report.none")}</p>}
      <ul className="ps-notes">
        {doc.notes.map((n) => (
          <li key={n.id}>
            <strong>{n.targetLabel}</strong> <span className="muted small">{hm(n.createdAt)}</span>
            <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
          </li>
        ))}
      </ul>

      <h2>{t("vehicles.title", { count: doc.vehicles.length })}</h2>
      <VehicleUseList uses={doc.vehicles} />

      <h2>{t("report.locations")}</h2>
      <div className="psc-board" data-testid="report-locations">
        {doc.locations.map((card) => (
          <LocationCardView key={card.id ?? `checklist:${card.name}`} card={card} hm={hm} />
        ))}
      </div>
    </div>
  );
}

function Photos({ srcs }: { srcs: string[] }) {
  if (srcs.length === 0) return null;
  return (
    <div className="ps-photos">
      {srcs.map((s, i) => (
        <a key={i} href={s} target="_blank" rel="noreferrer">
          <img src={s} alt="" />
        </a>
      ))}
    </div>
  );
}

function SincePanel({ handedIn, since, hm }: { handedIn: string; since: Since | undefined; hm: (iso: string) => string }) {
  const { t } = useTranslation("reports");
  const rows = since?.rows ?? [];
  return (
    <div className="psd-since" data-testid="report-since">
      <div className="report-kicker">
        {rows.length > 0 ? t("report.sinceCount", { count: rows.length }) : t("report.since")}
      </div>
      {rows.length === 0 ? (
        <div className="muted">{t("report.noChanges", { status: handedIn })}</div>
      ) : (
        <>
          <div className="psb-now">
            <strong>{t("report.now", { status: since?.now ?? handedIn })}</strong>
            {since?.now && <span className="muted"> {t("report.was", { status: handedIn })}</span>}
          </div>
          <ol className="psd-thread">
            {rows.map((r) => (
              <li key={r.id}>
                <span className="muted small">{t("timeline.by", { name: r.author_name ?? "—", when: hm(r.created_at) })}</span>
                <div>{describeSince(r, t as unknown as (k: string, v?: Record<string, string>) => string)}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function describeSince(r: SinceRow, t: (k: string, v?: Record<string, string>) => string): ReactNode {
  if (r.kind === "addendum") {
    return (
      <>
        <strong>{t("timeline.addendum")}</strong>: <span style={{ whiteSpace: "pre-wrap" }}>{r.body}</span>
      </>
    );
  }
  const d = describeUpdate({ ...r, body: r.body });
  const text = t(d.key, d.values);
  return r.kind === "comment" ? (
    <>
      <strong>{t("timeline.commentLabel")}</strong>: <span style={{ whiteSpace: "pre-wrap" }}>{r.body}</span>
    </>
  ) : (
    <strong>{text}</strong>
  );
}

function LocationCardView({ card, hm }: { card: LocationCard; hm: (iso: string) => string }) {
  const { t } = useTranslation("reports");
  const [all, setAll] = useState(false);
  const problems = card.items.filter((i) => i.mark !== "ok");
  const shown = all ? card.items : problems;
  const missed = card.items.filter((i) => i.mark === "missed").length;
  const exceptions = card.items.filter((i) => i.mark === "exception").length;
  const span = card.firstAt && card.lastAt ? (card.firstAt === card.lastAt ? hm(card.firstAt) : `${hm(card.firstAt)} – ${hm(card.lastAt)}`) : null;
  return (
    <section className={`psc-card psc-${worstMark(card.items)}`} data-testid="report-location">
      <div className="psc-card-head">
        <div>
          {card.path.length > 0 && <div className="muted small">{card.path.join(" › ")}</div>}
          {card.id === null && <div className="muted small">{t("report.noLocation")}</div>}
          <strong>{card.name}</strong>
          {span && <div className="muted small">{span}</div>}
        </div>
        <div className="psc-counts small">
          {card.checkIns > 0 && <span>{t("report.checkInsCount", { count: card.checkIns })}</span>}
          {missed > 0 && <span className="psc-bad">{t("report.missed", { count: missed })}</span>}
          {exceptions > 0 && <span className="psc-warn">{t("report.exceptions", { count: exceptions })}</span>}
          {missed + exceptions === 0 && <span className="psc-good">{t("report.allAsExpected")}</span>}
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="psc-items">
          {shown.map((i) => (
            <ItemRow key={i.id} item={i} hm={hm} />
          ))}
        </ul>
      )}
      {card.items.length > problems.length && (
        <button type="button" className="btn btn-sm psc-more report-noprint" onClick={() => setAll(!all)}>
          {all ? t("report.showProblemsOnly") : t("report.showMore", { count: card.items.length - problems.length })}
        </button>
      )}
    </section>
  );
}

function ItemRow({ item: i, hm }: { item: RecordItem; hm: (iso: string) => string }) {
  const { t } = useTranslation("reports");
  const result = t(`result.${i.result.key}` as "result.done", (i.result.values ?? {}) as { state: string });
  return (
    <li className={`psc-item-${i.mark}`}>
      <span>
        {i.kind === "checkin" ? "📍 " : ""}
        {i.label}
        <div className="muted small">
          {[i.source, i.at ? hm(i.at) : null, i.note].filter(Boolean).join(" · ")}
        </div>
      </span>
      <span className="psc-result">{result}</span>
    </li>
  );
}
