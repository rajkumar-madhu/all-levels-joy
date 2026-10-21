import { useState } from "react";
import { useAddRequestTask, useRequestTasks, useSetRequestTaskState, type TaskState } from "@/api/cmdb";
import { formatDateTime, humanize } from "@/lib/format";
import { localWindowTimeToIso } from "@/lib/security-window";
import { RecordStateBadge } from "./badges";
import { Button, FormError, Input, Panel, Select, StateMessage } from "./ui";

const TASK_STATES: TaskState[] = ["open", "in_progress", "closed", "cancelled"];

/** Fulfilment tasks on a service request (staff only; requesters never load them). */
export function RequestTasks({ orgId, requestId, approved }: { orgId: string; requestId: string; approved: boolean }) {
  const tasks = useRequestTasks(orgId, requestId, true);
  const add = useAddRequestTask(orgId, requestId);
  const setState = useSetRequestTaskState(orgId, requestId);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [dueError, setDueError] = useState<string | null>(null);

  return (
    <Panel className="grid gap-3 p-4">
      <h2 className="text-sm font-semibold">Fulfilment tasks</h2>
      {tasks.isPending ? (
        <StateMessage kind="loading">Loading tasks…</StateMessage>
      ) : tasks.isError ? (
        <StateMessage kind="error">{tasks.error.message}</StateMessage>
      ) : tasks.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="grid gap-2">
          {tasks.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.assignee_name ?? "Unassigned"}
                  {t.due_at ? ` · due ${formatDateTime(t.due_at)}` : ""}
                </span>
              </span>
              <RecordStateBadge state={t.state as never} />
              <Select
                aria-label={`State of ${t.title}`}
                className="w-36!"
                value={t.state}
                disabled={setState.isPending}
                onChange={(e) => setState.mutate({ id: t.id, state: e.target.value as TaskState, expectedUpdatedAt: t.updated_at })}
              >
                {TASK_STATES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            </li>
          ))}
        </ul>
      )}
      {approved ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            let dueAt: string | undefined;
            try {
              dueAt = due ? localWindowTimeToIso(due) : undefined;
              setDueError(null);
            } catch (err) {
              setDueError(err instanceof Error ? err.message : "Choose a valid due time.");
              return;
            }
            add.mutate({ title: title.trim(), ...(dueAt ? { dueAt } : {}) }, { onSuccess: () => { setTitle(""); setDue(""); } });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Input id="task-title" aria-label="New task" placeholder="Add a task, e.g. Assign licence" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required />
            <Input id="task-due" aria-label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          {dueError && <p role="alert" className="text-sm text-destructive">{dueError}</p>}
          <FormError error={add.error ?? setState.error} />
          <div><Button type="submit" variant="secondary" busy={add.isPending}>Add task</Button></div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Tasks can be added once the request is approved.</p>
      )}
    </Panel>
  );
}
