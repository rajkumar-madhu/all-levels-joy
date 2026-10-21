import { Download, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { downloadAttachment, useAttachments, useUploadAttachment, type Attachment, type AttachmentRecordType } from "@/api/insights";
import { formatDateTime } from "@/lib/format";
import { MAX_UPLOAD_BYTES, formatSize } from "@/lib/insights";
import { Button, FormError, Panel, StateMessage } from "./ui";

/** Evidence files on a record. Uploads and downloads go through the API, which checks access each time. */
export function Attachments({ orgId, recordType, recordId }: { orgId: string; recordType: AttachmentRecordType; recordId: string }) {
  const files = useAttachments(orgId, recordType, recordId);
  const upload = useUploadAttachment(orgId, recordType, recordId);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Files can be at most 25 MB.");
      return;
    }
    upload.mutate(file, { onSettled: () => input.current && (input.current.value = "") });
  };

  const download = (row: Attachment) => {
    setError(null);
    downloadAttachment(orgId, row).catch((e: unknown) => setError(e instanceof Error ? e.message : "Download failed."));
  };

  return (
    <Panel className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Attachments</h2>
        <Button variant="secondary" busy={upload.isPending} onClick={() => input.current?.click()}>
          <Paperclip className="size-4" aria-hidden /> {upload.isPending ? "Uploading…" : "Attach file"}
        </Button>
        <input
          ref={input}
          id={`attachment-${recordType}`}
          type="file"
          className="sr-only"
          aria-label="Attach file"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <FormError error={upload.error} />
      {files.isPending ? (
        <StateMessage kind="loading">Loading attachments…</StateMessage>
      ) : files.isError ? (
        <StateMessage kind="error">{files.error.message}</StateMessage>
      ) : files.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <ul className="divide-y divide-border">
          {files.data.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(row.size_bytes)}
                  {row.size_bytes !== null ? " · " : ""}
                  {row.uploader_name ? `${row.uploader_name} · ` : ""}
                  {formatDateTime(row.created_at)}
                </p>
              </div>
              <Button variant="secondary" onClick={() => download(row)} aria-label={`Download ${row.file_name}`}>
                <Download className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
