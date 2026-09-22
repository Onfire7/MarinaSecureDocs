import { useQuery } from "@powersync/react";
import { stamp } from "../lib/db";
import { insert, transact } from "./sql";
import { recordActivity } from "./activity";
import {
  attachmentColumns,
  attachmentJoins,
  attachmentSelect,
  type AttachedRow,
  type AttachmentTarget,
} from "./attachments";

// Notes — free text attached to exactly one thing.

export interface NoteRow extends AttachedRow {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
}

const NOTE_SELECT = `
  SELECT n.*, u.name AS author_name, ${attachmentSelect("n")}
    FROM notes n
    LEFT JOIN users u ON u.id = n.author_id
    ${attachmentJoins("n")}`;

export function useNotesForTarget(
  column: "location_id" | "checkpoint_id" | "boat_id" | "vehicle_id" | "contact_id" | "asset_id",
  targetId: string | undefined,
) {
  return useQuery<NoteRow>(
    `${NOTE_SELECT} WHERE n.${column} = ? ORDER BY n.created_at DESC`,
    [targetId ?? ""],
  );
}

export async function createNote(
  body: string,
  target: AttachmentTarget,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const noteId = await insert(tx, "notes", {
      body,
      created_at: stamp(),
      author_id: actorId,
      ...attachmentColumns(target),
    });
    await recordActivity(tx, {
      eventType: "note.created",
      summary: `Note added on ${target.label}`,
      subjectType: "notes",
      subjectId: noteId,
      actorId,
    });
    return noteId;
  });
}
