import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createChatThread, deleteChatThread, listChatThreads } from "@/lib/assistant.functions";
import { formatDateTime } from "@/lib/itsm-shared";
import { cn } from "@/lib/utils";

export const chatThreadsQueryKey = ["chat-threads"] as const;

export function AssistantSidebar({ activeThreadId }: { activeThreadId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threads = useQuery({
    queryKey: chatThreadsQueryKey,
    queryFn: () => listChatThreads(),
  });

  const create = useMutation({
    mutationFn: () => createChatThread(),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: chatThreadsQueryKey });
      void navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (threadId: string) => deleteChatThread({ data: { threadId } }),
    onSuccess: async (_result, threadId) => {
      await queryClient.invalidateQueries({ queryKey: chatThreadsQueryKey });
      if (threadId === activeThreadId) void navigate({ to: "/assistant" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="flex h-full flex-col gap-3">
      <Button
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="w-full justify-start gap-2"
      >
        <Plus className="h-4 w-4" aria-hidden /> New chat
      </Button>

      <div className="space-y-1 overflow-y-auto" aria-label="Past chats">
        {threads.isLoading ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Loading chats…</p>
        ) : (threads.data ?? []).length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No chats yet.</p>
        ) : (
          (threads.data ?? []).map((thread) => (
            <div
              key={thread.id}
              className={cn(
                "flex items-center gap-1 rounded-md px-1",
                thread.id === activeThreadId ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <Link
                to="/assistant/$threadId"
                params={{ threadId: thread.id }}
                className="min-w-0 flex-1 px-2 py-2 text-left"
              >
                <span className="block truncate text-sm text-foreground">{thread.title}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {formatDateTime(thread.updated_at)}
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Delete ${thread.title}`}
                onClick={() => remove.mutate(thread.id)}
                className="rounded p-1.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
