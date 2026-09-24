// PROTOTYPE — throwaway. The queries the wizard needs that the audit data
// module doesn't have yet. Kept out of the page files so the prototype still
// obeys "pages never touch the database" (CLAUDE.md).
import { useQuery } from "@powersync/react";

/** Which questions the Rules attached to which target, for the whole audit.
 *  Joined on `id`, never on a foreign key (CLAUDE.md). */
export function useAuditTargetQuestions(auditId: string | undefined) {
  return useQuery<{ target_id: string; question_id: string }>(
    `SELECT tq.target_id, tq.question_id
       FROM audit_target_questions tq
       JOIN audit_targets t ON t.id = tq.target_id
      WHERE t.audit_id = ?`,
    [auditId ?? ""],
  );
}

/** Which targets of this audit already have a Finding - the wizard dims
 *  them and the "pending" filter drops them. */
export function useAuditFindingTargets(auditId: string | undefined) {
  return useQuery<{ target_id: string }>(
    "SELECT target_id FROM audit_findings WHERE audit_id = ? AND target_id IS NOT NULL",
    [auditId ?? ""],
  );
}
