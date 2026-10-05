import type React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TicketPlus } from "lucide-react";

import { AppShell, useWorkspace } from "@/components/app-shell";
import { AssistantSidebar, chatThreadsQueryKey } from "@/components/assistant-sidebar";
import { PageHeader } from "@/components/page-header";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
  createTicketFromChat,
  getChatThread,
  sendChatMessage,
  type SuggestedTicket,
} from "@/lib/assistant.functions";
import { categoryLabel, IMPACT_URGENCY_LABELS } from "@/lib/itsm-shared";
import assistantMark from "@/assets/assistant-mark.png";

export const Route = createFileRoute("/_authenticated/assistant/$threadId")({
  head: () => ({
    meta: [
      { title: "Support chat — WeCrew ITSM" },
      {
        name: "description",
        content:
          "Troubleshoot an IT issue with the WeCrew support assistant and log an incident when you confirm the draft.",
      },
      { property: "og:title", content: "Support chat — WeCrew ITSM" },
      {
        property: "og:description",
        content: "Guided IT troubleshooting with confirmed ticket creation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssistantThread,
});

const suggestions = [
  "My VPN keeps disconnecting every few minutes",
  "Outlook will not send mail since this morning",
  "I cannot print to the office printer",
];

function AssistantThread() {
  const { threadId } = Route.useParams();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const thread = useQuery({
    queryKey: ["chat-thread", threadId],
    queryFn: () => getChatThread({ data: { threadId } }),
  });

  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId]);

  const send = useMutation({
    mutationFn: (text: string) => sendChatMessage({ data: { threadId, text } }),
    onSuccess: async () => {
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ["chat-thread", threadId] });
      await queryClient.invalidateQueries({ queryKey: chatThreadsQueryKey });
      textareaRef.current?.focus();
    },
    onError: (error: Error) => {
      setPending(null);
      toast.error(error.message);
    },
  });

  const createTicket = useMutation({
    mutationFn: (messageId: string) => createTicketFromChat({ data: { messageId } }),
    onSuccess: async (incident) => {
      toast.success(`Ticket ${incident.number} created`);
      await queryClient.invalidateQueries({ queryKey: ["chat-thread", threadId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      await queryClient.invalidateQueries({ queryKey: ["incident-metrics"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || send.isPending) return;
    setInput("");
    setPending(trimmed);
    send.mutate(trimmed);
  }

  const messages = thread.data?.messages ?? [];
  const busy = send.isPending;

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        title={thread.data?.thread.title ?? "Support chat"}
        description="The assistant answers from the knowledge base and drafts a ticket when the service desk is needed."
      />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-border bg-card p-3">
          <AssistantSidebar activeThreadId={threadId} />
        </aside>

        <section className="flex min-h-[60vh] flex-col rounded-lg border border-border bg-card">
          <Conversation className="flex-1">
            <ConversationContent className="gap-5">
              {thread.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading conversation…</p>
              ) : messages.length === 0 && !pending ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <img
                    src={assistantMark}
                    alt="WeCrew support assistant"
                    loading="lazy"
                    width={72}
                    height={72}
                    className="h-16 w-16"
                  />
                  <p className="text-sm text-muted-foreground">
                    Tell me what is not working and I will help you fix it.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((item) => (
                      <Button
                        key={item}
                        variant="outline"
                        size="sm"
                        onClick={() => submit(item)}
                        disabled={busy}
                      >
                        {item}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.role === "assistant" ? (
                        <MessageResponse components={assistantMarkdownComponents}>{message.content}</MessageResponse>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </MessageContent>
                    {message.role === "assistant" && message.suggested_ticket ? (
                      <TicketProposal
                        ticket={message.suggested_ticket}
                        createdIncidentId={message.created_incident_id}
                        pending={createTicket.isPending}
                        onCreate={() => createTicket.mutate(message.id)}
                      />
                    ) : null}
                  </Message>
                ))
              )}

              {pending ? (
                <>
                  <Message from="user">
                    <MessageContent>
                      <p className="whitespace-pre-wrap">{pending}</p>
                    </MessageContent>
                  </Message>
                  <Message from="assistant">
                    <MessageContent>
                      <Shimmer>Thinking…</Shimmer>
                    </MessageContent>
                  </Message>
                </>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="border-t border-border p-3">
            <PromptInput
              onSubmit={(_message, event) => {
                event.preventDefault();
                submit(input);
              }}
            >
              <PromptInputTextarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Describe the IT issue you are seeing…"
                disabled={busy}
              />
              <PromptInputFooter className="justify-end">
                <PromptInputSubmit
                  {...(busy ? { status: "submitted" as const } : {})}
                  disabled={busy || input.trim().length === 0}
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function TicketProposal({
  ticket,
  createdIncidentId,
  pending,
  onCreate,
}: {
  ticket: SuggestedTicket;
  createdIncidentId: string | null;
  pending: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="mt-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <TicketPlus className="h-4 w-4" aria-hidden /> Suggested ticket
      </p>
      <p className="mt-2 font-medium text-foreground">{ticket.title}</p>
      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{ticket.description}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="inline">Category: </dt>
          <dd className="inline text-foreground">{categoryLabel(ticket.category)}</dd>
        </div>
        <div>
          <dt className="inline">Impact: </dt>
          <dd className="inline text-foreground">
            {IMPACT_URGENCY_LABELS[ticket.impact] ?? ticket.impact}
          </dd>
        </div>
        <div>
          <dt className="inline">Urgency: </dt>
          <dd className="inline text-foreground">
            {IMPACT_URGENCY_LABELS[ticket.urgency] ?? ticket.urgency}
          </dd>
        </div>
      </dl>
      {createdIncidentId ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Ticket created.{" "}
          <Link
            to="/incidents"
            search={{ record: createdIncidentId }}
            className="underline underline-offset-4"
          >
            Open the ticket
          </Link>
        </p>
      ) : (
        <Button size="sm" className="mt-3" onClick={onCreate} disabled={pending}>
          {pending ? "Creating…" : "Create this ticket"}
        </Button>
      )}
    </div>
  );
}

// Internal workspace links (knowledge articles, catalogue items) open in-app;
// anything else opens in a new tab.
const assistantMarkdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href && href.startsWith("/") && !href.startsWith("//") ? (
      <Link to={href as never} className="font-medium text-primary underline">
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-primary underline">
        {children}
      </a>
    ),
};
