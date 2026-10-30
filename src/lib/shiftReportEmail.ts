// The email a guard pastes to their supervisor (ShiftReportPage.spec.md § The
// email), and later the one the app sends. One pure function; the caller
// supplies the translator so the text is in the viewer's language.
import { summaryFacts, type ShiftReportDoc } from "./shiftReportDoc";

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface ShiftReportEmail {
  subject: string;
  body: string;
}

export function shiftReportEmail(
  doc: ShiftReportDoc,
  link: string,
  t: Translate,
  format: { day: (iso: string) => string; time: (iso: string) => string },
): ShiftReportEmail {
  const subject = t("email.subject", {
    guard: doc.shift.guardName,
    day: format.day(doc.shift.startedAt),
    start: format.time(doc.shift.startedAt),
    end: doc.shift.endedAt ? format.time(doc.shift.endedAt) : "",
  });
  const lines: string[] = summaryFacts(doc).map((p) => t(`summary.${p.key}`, p.values));
  if (doc.note) lines.push("", `“${doc.note}”`);
  if (doc.attention.length > 0) {
    lines.push("", t("email.attentionHeading"));
    for (const a of doc.attention) {
      lines.push(`- ${a.where ? a.where + ": " : ""}${t(`attention.${a.kind}`, a.values)}`);
    }
  }
  lines.push("", link);
  return { subject, body: lines.join("\n") };
}
