// A titled section of a page or a card. On a phone it is collapsed by
// default so the first screen stays scannable; on a desktop it is open and
// plain (LocationDetailPage.spec — Mobile vs. desktop). `collapsed` forces
// the collapsible form everywhere, for a section that is rarely wanted.
import type { ReactNode } from "react";

export function Section({
  title,
  isMobile,
  collapsed,
  action,
  children,
  testId,
}: {
  title: string;
  isMobile: boolean;
  /** Collapsible and closed on every screen. */
  collapsed?: boolean;
  /** A control at the title's right edge: "+ Add", a count. */
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  if (!isMobile && !collapsed) {
    return (
      <div data-testid={testId}>
        <div className="section-title spread">
          <span>{title}</span>
          {action}
        </div>
        <div className="stack" style={{ gap: 8 }}>{children}</div>
      </div>
    );
  }
  return (
    <details className="section-collapse" data-testid={testId}>
      <summary className="section-title">
        <span className="spread">
          <span>{title}</span>
          {action && <span onClick={(e) => e.preventDefault()}>{action}</span>}
        </span>
      </summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>{children}</div>
    </details>
  );
}
