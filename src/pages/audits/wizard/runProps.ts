import type { Answers, AnswerValue, Step, WizardItem, WizardTarget } from "../../../lib/auditWizard";

/** What the run screen is handed. Plain data and callbacks: the page owns
 *  the queries and the writing, the screen owns the moving about. */
export interface RunProps {
  auditName: string;
  targets: WizardTarget[];
  steps: Step[];
  index: number;
  setIndex: (i: number) => void;
  answers: Answers;
  /** Saves after every change - but a field being typed in commits on blur
   *  or Next, not on every keystroke. */
  setAnswer: (targetId: string, key: string, v: AnswerValue, immediate?: boolean) => void;
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
