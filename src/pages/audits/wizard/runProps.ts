import type { Answers, AnswerValue, Step, WizardItem, WizardTarget } from "../../../lib/auditWizard";

export type AnswerMode = "tap" | "typing" | "commit";

/** What the run screen is handed. Plain data and callbacks: the page owns
 *  the queries and the writing, the screen owns the moving about. */
export interface RunProps {
  auditName: string;
  targets: WizardTarget[];
  steps: Step[];
  index: number;
  setIndex: (i: number) => void;
  answers: Answers;
  /** How a value arrived: a deliberate `tap`, a character `typing`, or a
   *  field `commit` on blur or Next. A tap always writes - answering that a
   *  Service is present is a confirmation even when it already was. A
   *  commit writes only what differs from what the field held on arrival,
   *  because the run focuses a field when it lands on one and blurs it when
   *  it leaves, and scrolling past is not auditing. */
  setAnswer: (targetId: string, key: string, v: AnswerValue, mode?: AnswerMode) => void;
  itemsFor: (t: WizardTarget) => WizardItem[];
  statuses: { id: string; name: string }[];
  /** What the marina already records for this item, as a phrase. */
  onFile: (t: WizardTarget, item: WizardItem) => string | null;
  /** A target with a Finding, or one this run has answered. */
  answeredTarget: (id: string) => boolean;
  /** Set by THIS run, as opposed to pre-filled from what is on file. */
  touched: (targetId: string, itemKey: string) => boolean;
  /** "All changes sent", or what went wrong. */
  savedNote: string;
  onExit: () => void;
}
