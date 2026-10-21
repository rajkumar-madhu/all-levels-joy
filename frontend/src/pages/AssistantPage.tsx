import { useQueryClient } from "@tanstack/react-query";
import { Bot, MessageSquarePlus, SendHorizontal, Trash2 } from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  streamAssistantReply,
  useCreateThread,
  useDeleteThread,
  useThread,
  useThreads,
  useTicketFromMessage,
  type ChatMessage,
} from "@/api/assistant";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, FormError, PageHeader, Panel, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { relativeTime } from "@/lib/format";

const NOT_CONFIGURED = "The support assistant is not connected to an AI service yet. Ask your administrator to set it up.";

export function AssistantPage() {
  const workspace = useWorkspace();
  const { threadId } = useParams();
  const navigate = useNavigate();
  const threads = useThreads(workspace.id);
  const create = useCreateThread(workspace.id);
  const remove = useDeleteThread(workspace.id);

  const start = () => create.mutate(undefined, { onSuccess: (thread) => navigate(`/assistant/${thread.id}`) });

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Support assistant"
        description="Ask about VPN, Wi-Fi, email, printing, laptops, passwords or access. Answers come from the knowledge base, and the assistant can draft a ticket for you to confirm."
        actions={
          <Button onClick={start} busy={create.isPending}>
            <MessageSquarePlus className="size-4" /> New conversation
          </Button>
        }
      />
      <FormError error={create.error} />
      {threads.data && !threads.data.configured && <StateMessage kind="error">{NOT_CONFIGURED}</StateMessage>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <Panel className="p-2">
          {threads.isPending ? (
            <StateMessage kind="loading">Loading conversations…</StateMessage>
          ) : threads.isError ? (
            <StateMessage kind="error">{threads.error.message}</StateMessage>
          ) : threads.data.results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            <ul className="grid gap-1" aria-label="Conversations">
              {threads.data.results.map((t) => (
                <li key={t.id} className="group flex items-center gap-1">
                  <Link
                    to={`/assistant/${t.id}`}
                    aria-current={t.id === threadId ? "page" : undefined}
                    className={clsx(
                      "min-w-0 flex-1 rounded-md px-3 py-2 text-sm",
                      t.id === threadId ? "bg-accent font-medium" : "hover:bg-muted",
                    )}
                  >
                    <span className="block truncate">{t.title}</span>
                    <span className="block text-xs text-muted-foreground">{relativeTime(t.updated_at)}</span>
                  </Link>
                  <button
                    aria-label={`Delete ${t.title}`}
                    className="rounded p-2 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                    onClick={() =>
                      remove.mutate(t.id, { onSuccess: () => t.id === threadId && navigate("/assistant", { replace: true }) })
                    }
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {threadId ? (
          <Conversation key={threadId} orgId={workspace.id} threadId={threadId} />
        ) : (
          <Panel className="grid justify-items-center gap-3 p-10 text-center">
            <Bot className="size-8 text-muted-foreground" aria-hidden />
            <p className="max-w-md text-sm text-muted-foreground">
              Start a conversation to get step-by-step help. If something needs the service desk, the assistant drafts a
              ticket and you decide whether to raise it.
            </p>
            <Button onClick={start} busy={create.isPending}>
              <MessageSquarePlus className="size-4" /> New conversation
            </Button>
          </Panel>
        )}
      </div>
    </>
  );
}

function Conversation({ orgId, threadId }: { orgId: string; threadId: string }) {
  const thread = useThread(orgId, threadId);
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ question: string; answer: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [thread.data?.messages.length, pending?.answer]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const question = text.trim();
    if (!question || pending) return;
    setText("");
    setError(null);
    setPending({ question, answer: "" });
    abort.current = new AbortController();
    try {
      await streamAssistantReply(
        orgId,
        threadId,
        question,
        (delta) => setPending((p) => (p ? { ...p, answer: p.answer + delta } : p)),
        abort.current.signal,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(err);
    } finally {
      setPending(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["orgs", orgId, "assistant", "thread", threadId] }),
        client.invalidateQueries({ queryKey: ["orgs", orgId, "assistant", "threads"] }),
      ]);
    }
  };

  if (thread.isPending) return <StateMessage kind="loading">Loading conversation…</StateMessage>;
  if (thread.isError) return <StateMessage kind="error">{thread.error.message}</StateMessage>;

  return (
    <Panel className="flex min-h-[28rem] flex-col">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{thread.data.thread.title}</h2>
      <ol className="grid flex-1 content-start gap-4 p-4" aria-live="polite">
        {thread.data.messages.length === 0 && !pending && (
          <li className="text-sm text-muted-foreground">Describe what is wrong or what you need.</li>
        )}
        {thread.data.messages.map((m) => (
          <Message key={m.id} message={m} orgId={orgId} threadId={threadId} />
        ))}
        {pending && (
          <>
            <UserBubble text={pending.question} />
            <li className="max-w-[85%]">
              {pending.answer ? <Markdown source={pending.answer} /> : <p className="text-sm text-muted-foreground">Thinking…</p>}
            </li>
          </>
        )}
        <div ref={end} />
      </ol>
      <form className="grid gap-2 border-t border-border p-3" onSubmit={send}>
        <FormError error={error} />
        <div className="flex items-end gap-2">
          <Textarea
            id="assistant-input"
            aria-label="Message"
            rows={2}
            maxLength={4000}
            value={text}
            placeholder={thread.data.configured ? "Ask a question…" : NOT_CONFIGURED}
            disabled={!thread.data.configured}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" busy={Boolean(pending)} disabled={!text.trim() || !thread.data.configured} aria-label="Send">
            <SendHorizontal className="size-4" />
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <li className="max-w-[85%] justify-self-end rounded-md bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
      {text}
    </li>
  );
}

function Message({ message: m, orgId, threadId }: { message: ChatMessage; orgId: string; threadId: string }) {
  const ticket = useTicketFromMessage(orgId, threadId);
  if (m.role === "user") return <UserBubble text={m.content} />;
  const proposal = m.suggested_ticket;
  return (
    <li className="grid max-w-[85%] gap-3">
      <Markdown source={m.content} />
      {proposal && (
        <div className="grid gap-2 rounded-md border border-border bg-muted p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Suggested ticket</span>
            <Badge mono tone={proposal.impact + proposal.urgency <= 2 ? "bad" : "neutral"}>
              Impact {proposal.impact} · Urgency {proposal.urgency}
            </Badge>
            {proposal.category && <Badge>{proposal.category}</Badge>}
          </div>
          <p className="font-medium">{proposal.title}</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{proposal.description}</p>
          <FormError error={ticket.error} />
          {m.created_incident_id ? (
            <Link to={`/incidents/${m.created_incident_id}`} className="text-primary underline">
              Ticket raised — open it
            </Link>
          ) : ticket.data ? (
            <Link to={`/incidents/${ticket.data.id}`} className="text-primary underline">
              {ticket.data.number} raised — open it
            </Link>
          ) : (
            <div>
              <Button busy={ticket.isPending} onClick={() => ticket.mutate(m.id)}>
                Raise this ticket
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
