import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMarkNotificationsRead, useNotifications } from "@/api/admin";
import { formatDateTime } from "@/lib/format";
import { Button } from "./ui";

/** Recent notifications. Opening the list does not mark anything read; "Mark all read" is a separate action. */
export function NotificationBell({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const notifications = useNotifications(orgId);
  const markRead = useMarkNotificationsRead(orgId);
  const root = useRef<HTMLDivElement>(null);
  const unread = notifications.data?.unreadRecent ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex size-9 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden />
        <span className="sr-only">Notifications{unread ? `, ${unread} unread among the recent ones` : ""}</span>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full border-2 border-card bg-primary px-0.5 text-[9px] font-semibold text-primary-foreground"
          >
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Recent notifications"
          className="absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-2rem))] rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Recent notifications</h2>
            <p className="mt-1 text-xs text-muted-foreground">Your 20 most recent notifications in this workspace.</p>
          </div>
          {notifications.isError ? (
            <p role="alert" className="px-4 py-6 text-sm text-destructive">{notifications.error.message}</p>
          ) : !notifications.data ? (
            <p role="status" className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : notifications.data.results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {notifications.data.results.map((n) => (
                <li key={n.id} className={n.read_at ? "px-4 py-3" : "bg-primary/[0.035] px-4 py-3"}>
                  <p className="flex items-start gap-2 text-sm font-medium">
                    {!n.read_at && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">Unread: </span>
                      </span>
                    )}
                    {n.title}
                  </p>
                  {n.body && <p className="mt-1 text-xs leading-relaxed break-words text-muted-foreground">{n.body}</p>}
                  <span className="mt-2 block text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border p-2">
            <Button variant="secondary" className="w-full" busy={markRead.isPending} disabled={unread === 0} onClick={() => markRead.mutate()}>
              Mark all read
            </Button>
            {markRead.isError && <p role="alert" className="px-2 pt-2 text-xs text-destructive">{markRead.error.message}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
