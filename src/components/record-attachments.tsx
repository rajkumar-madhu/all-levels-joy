import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { listAttachments, registerAttachment } from "@/lib/itsm.functions";
import { DEMO_ORG_ID, formatDateTime } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";

type AttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  created_at: string;
};

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordAttachments({
  recordType,
  recordId,
}: {
  recordType: string;
  recordId: string;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const attachments = useQuery<AttachmentRow[]>({
    queryKey: ["attachments", recordType, recordId],
    queryFn: () => listAttachments({ data: { recordType, recordId } }) as Promise<AttachmentRow[]>,
  });

  const register = useMutation({
    mutationFn: registerAttachment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attachments", recordType, recordId] });
      void queryClient.invalidateQueries({ queryKey: ["activity", recordType, recordId] });
      toast.success("File attached to the record.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Attachment was not saved."),
  });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(-120);
      const path = `${DEMO_ORG_ID}/${recordType}/${recordId}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("itsm-evidence").upload(path, file, {
        contentType: file.type || undefined,
      });
      if (error) throw new Error(error.message);
      await register.mutateAsync({
        data: {
          recordType,
          recordId,
          storagePath: path,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const download = async (row: AttachmentRow) => {
    const { data, error } = await supabase.storage
      .from("itsm-evidence")
      .createSignedUrl(row.storage_path, 120);
    if (error || !data?.signedUrl) {
      toast.error("Could not prepare the download.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Attachments
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {uploading ? "Uploading…" : "Attach file"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          aria-label="Choose a file to attach"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      <ol className="space-y-1.5 text-sm">
        {(attachments.data ?? []).map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-foreground">{row.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {formatSize(row.size_bytes)}
                {row.size_bytes ? " · " : ""}
                {formatDateTime(row.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void download(row)}
              aria-label={`Download ${row.file_name}`}
              className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Download className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
        {(attachments.data ?? []).length === 0 ? (
          <li className="text-sm text-muted-foreground">No files attached yet.</li>
        ) : null}
      </ol>
    </div>
  );
}
