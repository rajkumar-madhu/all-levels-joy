import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  addRequestTask,
  listRequestTasks,
  setRequestTaskState,
} from "@/lib/request-tasks.functions";
import { StateBadge } from "@/components/status-badge";
import { formatDateTime, type RecordState } from "@/lib/itsm-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequestTasks({ requestId, canWork }: { requestId: string; canWork: boolean }) {
  const queryClient = useQueryClient();
  const key = ["request-tasks", requestId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => listRequestTasks({ data: { requestId } }),
  });
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const onError = (e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved.");

  const add = useMutation({
    mutationFn: () =>
      addRequestTask({ data: dueAt ? { requestId, title, dueAt } : { requestId, title } }),
    onSuccess: async () => {
      setTitle("");
      setDueAt("");
      toast.success("Fulfillment task added.");
      await refresh();
    },
    onError,
  });
  const move = useMutation({
    mutationFn: (input: { id: string; state: "in_progress" | "closed" | "cancelled" }) =>
      setRequestTaskState({ data: input }),
    onSuccess: refresh,
    onError,
  });

  const tasks = query.data ?? [];
  const done = tasks.filter((t) => t.state === "closed" || t.state === "cancelled").length;

  return (
    <section className="space-y-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Fulfillment tasks</h3>
        {tasks.length ? (
          <span className="text-xs text-muted-foreground">
            {done} of {tasks.length} complete
          </span>
        ) : null}
      </div>
      {query.isPending ? (
        <p className="text-xs text-muted-foreground">Loading tasks…</p>
      ) : query.isError ? (
        <p className="text-xs text-destructive">Tasks could not be loaded.</p>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No fulfillment tasks yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 text-foreground">{task.title}</span>
              <span className="text-xs text-muted-foreground">
                Due {formatDateTime(task.due_at)}
              </span>
              <StateBadge state={task.state as RecordState} />
              {canWork && !["closed", "cancelled"].includes(task.state) ? (
                <>
                  {task.state !== "in_progress" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={move.isPending}
                      onClick={() => move.mutate({ id: task.id, state: "in_progress" })}
                    >
                      Start
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={move.isPending}
                    onClick={() => move.mutate({ id: task.id, state: "closed" })}
                  >
                    Complete
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWork ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            aria-label="Task title"
            placeholder="e.g. Image laptop"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            required
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Input
            aria-label="Task due date"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="h-8 w-auto text-xs"
          />
          <Button size="sm" type="submit" disabled={add.isPending}>
            Add task
          </Button>
        </form>
      ) : null}
    </section>
  );
}
