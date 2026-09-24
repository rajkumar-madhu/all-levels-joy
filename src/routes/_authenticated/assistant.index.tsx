import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { AssistantSidebar, chatThreadsQueryKey } from "@/components/assistant-sidebar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createChatThread } from "@/lib/assistant.functions";
import assistantMark from "@/assets/assistant-mark.png";

export const Route = createFileRoute("/_authenticated/assistant/")({
  head: () => ({
    meta: [
      { title: "IT support assistant — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Chat with the WeCrew IT support assistant to troubleshoot common IT issues and log an incident when you need one.",
      },
      { property: "og:title", content: "IT support assistant — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Guided troubleshooting for everyday IT issues, with one-click ticket creation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantIndex,
});

function AssistantIndex() {
  const workspace = useWorkspace();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: () => createChatThread(),
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: chatThreadsQueryKey });
      void navigate({ to: "/assistant/$threadId", params: { threadId: thread.id } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        title="IT support assistant"
        description="Describe an IT problem in plain words. The assistant walks you through fixes and can log a ticket when you confirm."
      />
      {workspace.isLoading ? (
        <WorkspaceLoading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-border bg-card p-3">
            <AssistantSidebar />
          </aside>
          <section className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card px-6 py-16 text-center">
            <img
              src={assistantMark}
              alt="WeCrew support assistant"
              loading="lazy"
              width={96}
              height={96}
              className="h-20 w-20"
            />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Start a support conversation
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Ask about VPN, Wi-Fi, email, printing, laptops, passwords or access. If the fix
                needs the service desk, the assistant drafts a ticket for you to confirm.
              </p>
            </div>
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? "Starting…" : "New chat"}
            </Button>
          </section>
        </div>
      )}
    </AppShell>
  );
}
