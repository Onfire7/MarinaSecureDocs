import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { dateTime } from "../../i18n";
import { updatesSince } from "../../lib/shiftReportDoc";
import { fetchShiftReport, type SharedShiftReport } from "../../data/sharedShiftReport";
import { ShiftReportView } from "./ShiftReportView";

// The page a Report Link opens: /r/shift/:id (ShiftReportPage.spec.md § The
// Report Link). Public: App.tsx routes it before the signed-in app's chunk is
// requested, and nothing imported here reaches Clerk, PowerSync or the app's
// Supabase client. It fetches the document once.
type Loaded = { state: "loading" } | { state: "gone" } | { state: "error"; message: string } | { state: "ready"; report: SharedShiftReport };

export function SharedShiftReportPage() {
  const { id } = useParams();
  const { t } = useTranslation("reports");
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    (id ? fetchShiftReport(id) : Promise.resolve(null)).then(
      (report) => live && setLoaded(report ? { state: "ready", report } : { state: "gone" }),
      (e: unknown) => live && setLoaded({ state: "error", message: (e as { message?: string }).message ?? String(e) }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="report-page">
      <div className="report-topbar report-noprint">
        <span className="report-brand">
          MarinaSecure <small>{t("public.brand")}</small>
        </span>
      </div>
      {loaded.state === "loading" && (
        <div className="placeholder">
          <div className="big">{t("public.loading")}</div>
        </div>
      )}
      {loaded.state === "gone" && (
        <div className="placeholder" data-testid="report-gone">
          <div className="big">{t("public.gone")}</div>
          <p className="muted">{t("public.goneHint")}</p>
        </div>
      )}
      {loaded.state === "error" && (
        <div className="placeholder">
          <div className="big">{t("public.error")}</div>
          <p className="muted">{loaded.message}</p>
        </div>
      )}
      {loaded.state === "ready" && loaded.report.status === "not_ended" && (
        <div className="report" data-testid="report-not-ended">
          <div className="report-letterhead">
            <div>
              <div className="report-kicker">{t("report.kicker", { marina: loaded.report.header.marinaName ?? "" })}</div>
              <h1>{loaded.report.header.guardName ?? ""}</h1>
              <div className="muted">
                {dateTime(loaded.report.header.startedAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
          </div>
          <p className="badge badge-warn" style={{ display: "inline-block" }}>
            {loaded.report.header.endedAt ? t("report.noReportPublic") : t("report.notEndedPublic")}
          </p>
        </div>
      )}
      {loaded.state === "ready" && loaded.report.status === "ended" && (
        <ShiftReportView
          doc={loaded.report.document}
          since={updatesSince(loaded.report.document, loaded.report.document.shift.endedAt, loaded.report.updates)}
          inApp={false}
        />
      )}
    </div>
  );
}
