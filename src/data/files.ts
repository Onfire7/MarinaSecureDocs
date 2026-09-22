import { useQuery } from "@powersync/react";
import { SUPABASE_URL } from "../lib/config";
import { supabase } from "../lib/db/supabase";
import { db, stamp } from "../lib/db";
import { insert, update } from "./sql";

// Attachment BYTES — the one thing PowerSync does not replicate.
//
// A row and its bytes travel separately: the attachments row syncs like any
// other, so the attachment's *existence* is never lost, while the bytes go to
// Supabase Storage over ordinary HTTP. That split is why upload_state exists.
// A row with upload_state = 'pending' is not broken; it is an attachment whose
// bytes have not had a connection yet, and it renders as pending rather than as
// a missing image.
//
// The queue that drains pending uploads independently of PowerSync's write
// queue is still to be built (docs/TODO.md). Until then an upload needs a
// connection at the moment it is made, and `capture` below says so by failing.

export const ATTACHMENT_BUCKET = "attachments";

export interface AttachmentRow {
  id: string;
  storage_path: string;
  content_type: string | null;
  byte_size: number | null;
  upload_state: string;
  uploaded_by_id: string | null;
  created_at: string;
}

/**
 * A public URL for an attachment's bytes.
 *
 * Built by hand rather than through the Supabase client, because this is called
 * during render for every image on a page and the client's own helper
 * allocates a request-shaped object to return a string.
 */
export function attachmentUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${ATTACHMENT_BUCKET}/${storagePath}`;
}

export function useAttachment(attachmentId: string | null | undefined) {
  const { data } = useQuery<AttachmentRow>(
    "SELECT * FROM attachments WHERE id = ?",
    [attachmentId ?? ""],
  );
  return data[0] ?? null;
}

/**
 * Record an attachment and upload its bytes.
 *
 * The row is written first and separately, so that a failed upload leaves a
 * pending row rather than nothing at all — the difference between "this photo
 * is still uploading" and the photo never having been taken.
 */
export async function captureAttachment(
  file: File,
  actorId: string | null,
): Promise<string> {
  const attachmentId = await insert(db, "attachments", {
    storage_path: "",
    content_type: file.type || null,
    byte_size: file.size,
    upload_state: "pending",
    uploaded_by_id: actorId,
    created_at: stamp(),
  });

  // Keyed by the row's own id, so a retry overwrites rather than accumulating
  // orphaned objects nothing points at.
  const path = `${attachmentId}/${file.name}`;
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) {
    await update(db, "attachments", attachmentId, { storage_path: path });
    throw error;
  }

  await update(db, "attachments", attachmentId, {
    storage_path: path,
    upload_state: "uploaded",
  });
  return attachmentId;
}
