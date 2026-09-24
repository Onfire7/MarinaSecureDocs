// Sorting Proposals by what a decision would actually mean
// (docs/audits.md § Filling a blank is not a decision).
//
// An audit of 76 campsites produced 460 undecided Proposals and one
// undivided list. A handful of them were real questions - this reading
// disagrees with the one on file, this Service has gone - and the handful
// is exactly what gets lost when it is shown alongside four hundred that
// decide nothing.
//
// New Proposals that fill a blank no longer exist: the database applies
// them as they are recorded. Audits recorded before that change still
// carry theirs, and this is how a person clears them in one press without
// pretending to have read all 460.

export type ProposalClass = "blank" | "removal" | "change" | "structural";

export interface ClassifiableProposal {
  kind: string;
  structural: number;
  /** 1 when nothing is on file for what this Proposal names. Computed in
   *  the query, against the Location as it stands now. */
  fills_blank?: number;
  payload: string;
}

export const CLASS_LABEL: Record<ProposalClass, string> = {
  blank: "Fills a blank",
  removal: "Removes something",
  change: "Changes a value",
  structural: "Structural",
};

export const CLASS_HINT: Record<ProposalClass, string> = {
  blank: "Nothing is on file for these. Approving decides nothing, so they are ticked for you.",
  removal: "Something on file goes away. A Service reads absent when it is under leaves as often as when it is gone.",
  change: "Two readings disagree, and somebody has to say which is right.",
  structural: "These reshape the marina itself.",
};

/** Undecided first, and within them the ones that decide nothing first -
 *  they are what a person is here to clear. */
export const CLASS_ORDER: ProposalClass[] = ["blank", "change", "removal", "structural"];

function payloadOf(p: ClassifiableProposal): Record<string, unknown> {
  try {
    const v = JSON.parse(p.payload) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function classifyProposal(p: ClassifiableProposal): ProposalClass {
  if (p.structural === 1) return "structural";
  const pl = payloadOf(p);
  if (p.kind === "set_service" || p.kind === "set_amenity") {
    if (pl.present === false) return "removal";
    return p.fills_blank === 1 ? "blank" : "change";
  }
  if (p.kind === "set_attribute") {
    // A null value on both columns is a clear, which takes something away.
    if (pl.value == null && pl.text == null) return "removal";
    return p.fills_blank === 1 ? "blank" : "change";
  }
  // GPS is held whatever the Location knows: a wrong pin misleads everyone
  // who follows it, and there is no blank worth filling unreviewed.
  return "change";
}

export interface ProposalGroup<T> {
  cls: ProposalClass;
  label: string;
  hint: string;
  rows: T[];
}

/** Group for display, keeping each group's incoming order. Empty groups are
 *  dropped - a heading with nothing under it reads like a filter that ate
 *  the rows. */
export function groupProposals<T extends ClassifiableProposal>(rows: T[]): ProposalGroup<T>[] {
  return CLASS_ORDER.map((cls) => ({
    cls,
    label: CLASS_LABEL[cls],
    hint: CLASS_HINT[cls],
    rows: rows.filter((r) => classifyProposal(r) === cls),
  })).filter((g) => g.rows.length > 0);
}
