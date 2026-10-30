import { useState } from "react";
import { useTranslation } from "react-i18next";
import { date, time } from "../../i18n";
import { publicOrigin } from "../../lib/config";
import { shiftReportEmail } from "../../lib/shiftReportEmail";
import type { ShiftReportDoc } from "../../lib/shiftReportDoc";
import { useUploadQueue } from "../../data/sync";

// The email a guard pastes to their supervisor (ShiftReportPage.spec.md § The
// email): subject, body and the Report Link, each with its own Copy, plus
// Copy all and a mailto: convenience. Opened by End Shift and Submit and by
// the in-app page's Email report.
export function ShiftReportEmailDialog({ doc, onClose }: { doc: ShiftReportDoc; onClose: () => void }) {
  const { t } = useTranslation("reports");
  const queued = useUploadQueue();
  const link = `${publicOrigin()}/r/shift/${doc.shift.id}`;
  // A loose translator for the pure email builder, which addresses keys as strings.
  const tr = (key: string, values?: Record<string, string | number>) => String((t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values));
  const email = shiftReportEmail(doc, link, tr, {
    day: (iso) => date(iso, { weekday: "short", month: "short", day: "numeric" }),
    time: (iso) => time(iso, { hour: "numeric", minute: "2-digit" }),
  });
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
  const mailto = `mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={t("dialog.title")}
        data-testid="email-dialog"
        style={{ maxWidth: 640, width: "min(640px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-title" style={{ marginBottom: 6 }}>
          {t("dialog.title")}
        </div>
        <p className="muted small">{t("dialog.hint")}</p>

        <Field label={t("dialog.subject")} value={email.subject} rows={1} canCopy={canCopy} testId="email-subject" />
        <Field label={t("dialog.body")} value={email.body} rows={10} canCopy={canCopy} testId="email-body" />
        <Field label={t("dialog.link")} value={link} rows={1} canCopy={canCopy} testId="email-link" />
        {queued > 0 && <p className="muted small">{t("dialog.offline")}</p>}

        <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
          {canCopy && <CopyButton text={`${email.subject}\n\n${email.body}`} label={t("dialog.copyAll")} primary />}
          <a className="btn" href={mailto}>
            {t("dialog.openInMail")}
          </a>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("dialog.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, rows, canCopy, testId }: { label: string; value: string; rows: number; canCopy: boolean; testId: string }) {
  return (
    <div className="field">
      <div className="spread" style={{ alignItems: "baseline" }}>
        <span className="field-label">{label}</span>
        {canCopy && <CopyButton text={value} label={null} />}
      </div>
      <textarea className="textarea" readOnly rows={rows} value={value} aria-label={label} data-testid={testId} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

function CopyButton({ text, label, primary }: { text: string; label: string | null; primary?: boolean }) {
  const { t } = useTranslation("reports");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" className={`btn btn-sm ${primary ? "btn-primary" : ""}`} onClick={() => void copy()}>
      {copied ? t("dialog.copied") : (label ?? t("dialog.copy"))}
    </button>
  );
}
