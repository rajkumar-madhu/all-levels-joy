import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Copy,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ADMIN_ROLES,
  type AdminGroup,
  type AdminInvitation,
  type AdminMember,
  type AdminOverview,
  type InviteMemberInput,
  type SaveGroupInput,
  type UpdateMemberInput,
  type UpdateWorkspaceInput,
} from "@/lib/admin-contract";
import {
  getAdministration,
  inviteMember,
  revokeInvitation,
  saveGroup,
  updateMember,
  updateWorkspaceSettings,
} from "@/lib/admin.functions";
import { ROLE_LABELS, formatDateTime, type AppRole } from "@/lib/itsm-shared";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/administration")({
  head: () => ({
    meta: [
      { title: "Administration — WeCrew ITSM" },
      {
        name: "description",
        content: "Manage workspace members, invitations, assignment groups, and settings.",
      },
    ],
  }),
  component: Administration,
});

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  requester: "Raise and follow your own requests and incidents.",
  service_desk: "Triage and manage service operations.",
  fulfiller: "Deliver approved service requests.",
  change_manager: "Coordinate change delivery and governance.",
  cab_member: "Review change approval tasks assigned to you.",
  cmdb_manager: "Maintain assets and configuration items.",
  manager: "Oversee operations and approval decisions.",
  admin: "Manage workspace access, roles, groups, and settings.",
};
const PAGE_SIZE = 25;
const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function ErrorMessage({ error }: { error: Error | null }) {
  return error ? (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
    >
      {error.message || "The update could not be completed. Please try again."}
    </p>
  ) : null;
}

function StatusBadge({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        active
          ? "border-emerald-700/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-emerald-600" : "bg-muted-foreground/60",
        )}
        aria-hidden
      />
      {children}
    </span>
  );
}

function RoleBadges({ roles }: { roles: AppRole[] }) {
  return (
    <ul aria-label="Assigned roles" className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <li
          key={role}
          className={cn(
            "rounded border px-2 py-0.5 text-[11px]",
            role === "admin"
              ? "border-primary/20 bg-primary/5 text-primary"
              : "border-border bg-secondary/60 text-secondary-foreground",
          )}
        >
          {ROLE_LABELS[role]}
        </li>
      ))}
    </ul>
  );
}

function RoleSelector({
  roles,
  onChange,
  disabled,
}: {
  roles: AppRole[];
  onChange: (roles: AppRole[]) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">Assigned roles</legend>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Requester is the baseline role. Additional roles grant access to operational records and
        actions.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_ROLES.map((role) => (
          <label
            key={role}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3",
              roles.includes(role) ? "border-primary/30 bg-primary/[0.03]" : "border-border",
              role === "requester" && "cursor-default",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              checked={roles.includes(role)}
              disabled={role === "requester" || disabled}
              onChange={(event) =>
                onChange(
                  ADMIN_ROLES.filter(
                    (candidate) =>
                      candidate === "requester" ||
                      (candidate === role ? event.target.checked : roles.includes(candidate)),
                  ),
                )
              }
            />
            <span>
              <span className="block text-xs font-medium">{ROLE_LABELS[role]}</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                {ROLE_DESCRIPTIONS[role]}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-5 py-12 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}

function Administration() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const isAdmin = workspace.data?.roles.includes("admin") ?? false;
  const overview = useQuery({
    queryKey: ["administration"],
    queryFn: () => getAdministration(),
    enabled: isAdmin,
    retry: false,
    staleTime: 15_000,
  });
  async function refresh() {
    // Refresh after rejected mutations as well as successful ones. Editors keep
    // their original snapshot until closed; reopening must use the current roles,
    // membership state, and version instead of repeating the same stale write.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["administration"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["reference"] }),
    ]);
  }

  return (
    <AppShell workspace={workspace.data}>
      <PageHeader
        eyebrow="Workspace management"
        title="Administration"
        description="Give the right people the right access, organize service teams, and manage your workspace."
      />
      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : !isAdmin ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">Administrator access required</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Only active workspace administrators can manage members, invitations, assignment groups,
            and workspace settings. Ask your administrator if you need access.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              <span>Changes are permission-checked and recorded in the audit trail.</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void overview.refetch()}
              disabled={overview.isFetching}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  overview.isFetching && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden
              />
              {overview.isFetching ? "Refreshing…" : "Refresh data"}
            </Button>
          </div>
          {overview.isError ? (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-card p-4">
              <ErrorMessage error={overview.error} />
              <p className="text-xs text-muted-foreground">
                {overview.data
                  ? "The last loaded snapshot is shown below. Refresh before starting another change."
                  : "Administration data could not be loaded."}
              </p>
              <Button
                variant="outline"
                onClick={() => void overview.refetch()}
                disabled={overview.isFetching}
              >
                Retry administration
              </Button>
            </div>
          ) : null}
          {overview.isPending ? (
            <WorkspaceLoading />
          ) : overview.data ? (
            <AdministrationTabs data={overview.data} onRefresh={refresh} />
          ) : null}
        </div>
      )}
    </AppShell>
  );
}

function AdministrationTabs({
  data,
  onRefresh,
}: {
  data: AdminOverview;
  onRefresh: () => Promise<void>;
}) {
  return (
    <Tabs defaultValue="members" className="space-y-5">
      <div className="overflow-x-auto pb-1">
        <TabsList className="h-auto min-w-max gap-1 bg-muted/70 p-1">
          <TabsTrigger value="members" className="gap-2 px-3 py-2">
            <Users className="h-4 w-4" aria-hidden />
            Members{" "}
            <span className="font-mono text-[11px] text-muted-foreground">
              {data.members.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="invitations" className="gap-2 px-3 py-2">
            <Mail className="h-4 w-4" aria-hidden />
            Invitations
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-2 px-3 py-2">
            <UsersRound className="h-4 w-4" aria-hidden />
            Assignment groups
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 px-3 py-2">
            <Building2 className="h-4 w-4" aria-hidden />
            Workspace settings
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="members">
        <MembersPanel members={data.members} onRefresh={onRefresh} />
      </TabsContent>
      <TabsContent value="invitations">
        <InvitationsPanel invitations={data.invitations} onRefresh={onRefresh} />
      </TabsContent>
      <TabsContent value="groups">
        <GroupsPanel groups={data.groups} members={data.members} onRefresh={onRefresh} />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsPanel organization={data.organization} onRefresh={onRefresh} />
      </TabsContent>
    </Tabs>
  );
}

function MembersPanel({
  members,
  onRefresh,
}: {
  members: AdminMember[];
  onRefresh: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminMember | null>(null);
  const query = search.trim().toLowerCase();
  const filtered = members.filter(
    (member) =>
      (status === "all" || member.is_active === (status === "active")) &&
      `${member.display_name} ${member.email ?? ""}`.toLowerCase().includes(query),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return (
    <section className="space-y-4" aria-labelledby="members-title">
      <div>
        <h2 id="members-title" className="text-base font-semibold">
          Workspace members
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage active access and review every assigned role. Deactivation retains the member’s
          records and audit history.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="member-search" className="text-xs">
            Search members
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="member-search"
              className="pl-9"
              placeholder="Name or email"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5 sm:w-44">
          <Label htmlFor="member-status" className="text-xs">
            Access status
          </Label>
          <select
            id="member-status"
            className={selectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All members</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtered.length} matching {filtered.length === 1 ? "member" : "members"} · {members.length}{" "}
        in the complete workspace snapshot · 25 per page
      </p>
      {rows.length ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {rows.map((member) => (
            <article
              key={member.id}
              className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="break-words text-sm font-semibold">
                    {member.display_name || "Unnamed member"}
                  </h3>
                  <StatusBadge active={member.is_active}>
                    {member.is_active ? "Active" : "Inactive"}
                  </StatusBadge>
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {member.email ?? "Email unavailable"}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Joined {formatDateTime(member.created_at)}
                </p>
              </div>
              <RoleBadges roles={member.roles} />
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                aria-label={`Manage access for ${member.display_name || member.email || "member"}`}
                onClick={() => setEditing({ ...member, roles: [...member.roles] })}
              >
                Manage access
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No members match your filters">
          Try a different name, email, or access status.
        </EmptyState>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {filtered.length
            ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`
            : "Showing 0 members"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Previous members page"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {currentPage} / {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-label="Next members page"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      {editing ? (
        <MemberEditor
          key={editing.id}
          member={editing}
          onClose={() => setEditing(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </section>
  );
}

function MemberEditor({
  member,
  onClose,
  onRefresh,
}: {
  member: AdminMember;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [roles, setRoles] = useState<AppRole[]>(
    ADMIN_ROLES.filter((role) => role === "requester" || member.roles.includes(role)),
  );
  const [isActive, setIsActive] = useState(member.is_active);
  const [review, setReview] = useState(false);
  const changed =
    isActive !== member.is_active ||
    roles.length !== member.roles.length ||
    roles.some((role) => !member.roles.includes(role));
  const save = useMutation({
    mutationFn: (input: UpdateMemberInput) => updateMember({ data: input }),
    onError: onRefresh,
    onSuccess: async () => {
      toast.success("Member access updated.");
      await onRefresh();
      onClose();
    },
  });
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !save.isPending) onClose();
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage member access</DialogTitle>
            <DialogDescription>
              {member.display_name} · {member.email ?? "Email unavailable"}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              setReview(true);
            }}
          >
            <fieldset disabled={save.isPending} className="space-y-5">
              <label className="flex items-start gap-3 rounded-lg border border-border p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium">Active workspace access</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    Inactive members cannot access this workspace. Existing records and audit
                    history are retained.
                  </span>
                </span>
              </label>
              <RoleSelector roles={roles} onChange={setRoles} disabled={save.isPending} />
              {(!isActive ||
                member.roles.some(
                  (role) =>
                    ["admin", "manager", "cab_member"].includes(role) && !roles.includes(role),
                )) && (
                <p className="rounded-md border border-amber-700/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  Pending approvals keep their designated reviewer. Removing access or an approval
                  role can block those approvals. Review outstanding tasks first; completing them
                  later may require restoring access or cancelling and resubmitting the record.
                </p>
              )}
            </fieldset>
            <ErrorMessage error={save.error} />
            {save.isError ? (
              <p className="text-xs text-muted-foreground">
                If this record changed elsewhere, cancel and reopen it to review the latest access
                settings.
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending || !changed}>
                Review access changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={review}
        onOpenChange={(open) => {
          if (!save.isPending) setReview(open);
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm access changes</AlertDialogTitle>
            <AlertDialogDescription>
              Update access for {member.display_name || member.email}?{" "}
              {isActive
                ? "The member will have the roles shown below."
                : "This member will lose workspace access immediately. Their records will be retained."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs">
              <span className="font-medium">Access:</span>{" "}
              {member.is_active ? "Active" : "Inactive"} → {isActive ? "Active" : "Inactive"}
            </p>
            <div>
              <p className="mb-2 text-xs font-medium">Roles after this change</p>
              <RoleBadges roles={roles} />
            </div>
          </div>
          <ErrorMessage error={save.error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={save.isPending}>Back to editing</AlertDialogCancel>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  userId: member.user_id,
                  roles,
                  isActive,
                  expectedVersion: member.version,
                })
              }
            >
              {save.isPending ? "Saving access…" : "Confirm access changes"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InvitationsPanel({
  invitations,
  onRefresh,
}: {
  invitations: AdminInvitation[];
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(["requester"]);
  const [created, setCreated] = useState<{ id: string; email: string } | null>(null);
  const [revoking, setRevoking] = useState<AdminInvitation | null>(null);
  const [status, setStatus] = useState("all");
  const invite = useMutation({
    mutationFn: (input: InviteMemberInput) => inviteMember({ data: input }),
    onError: onRefresh,
    onSuccess: async (result, input) => {
      setCreated({ id: result.id, email: input.email });
      setOpen(false);
      setEmail("");
      setRoles(["requester"]);
      toast.success("Invitation created. Share the link with the invited person.");
      await onRefresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (invitation: AdminInvitation) =>
      revokeInvitation({
        data: { invitationId: invitation.id, expectedVersion: invitation.version },
      }),
    onError: onRefresh,
    onSuccess: async () => {
      setRevoking(null);
      toast.success("Invitation revoked.");
      await onRefresh();
    },
  });
  const visible = invitations.filter(
    (invitation) => status === "all" || invitation.status === status,
  );
  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/accept-invitation?invitation=${id}`,
      );
      toast.success("Invitation link copied.");
    } catch {
      toast.error(
        "Unable to copy the link. Open the invitation confirmation and copy the link manually.",
      );
    }
  }
  return (
    <section className="space-y-4" aria-labelledby="invitations-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="invitations-title" className="text-base font-semibold">
            Workspace invitations
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Invite a specific email address with the roles they need. Invitations expire after seven
            days.
          </p>
        </div>
        <Button
          onClick={() => {
            invite.reset();
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Invite member
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Verified email required.</span> An invitation
        grants access only after the invited person signs in with the matching verified email and
        accepts. Creating an invitation does not send an email.
      </div>
      {created ? (
        <div
          role="status"
          className="space-y-3 rounded-lg border border-emerald-700/20 bg-emerald-500/5 p-4"
        >
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold">Invitation created for {created.email}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Share this link with the invited person. An email has not been sent.
              </p>
            </div>
          </div>
          <Label htmlFor="created-invitation-link" className="text-xs">
            Invitation link
          </Label>
          <Input
            id="created-invitation-link"
            readOnly
            value={`${window.location.origin}/accept-invitation?invitation=${created.id}`}
            onFocus={(event) => event.target.select()}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyLink(created.id)}>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy invitation link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
      <div className="w-full max-w-xs space-y-1.5">
        <Label htmlFor="invitation-status" className="text-xs">
          Invitation status
        </Label>
        <select
          id="invitation-status"
          className={selectClass}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All invitations ({invitations.length})</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>
      {visible.length ? (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {visible.map((invitation) => (
            <article
              key={invitation.id}
              className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <h3 className="break-all text-sm font-semibold">{invitation.email}</h3>
                <div className="mt-2">
                  <StatusBadge active={invitation.status === "pending"}>
                    {invitation.status.charAt(0).toUpperCase() + invitation.status.slice(1)}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Created {formatDateTime(invitation.created_at)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Expires {formatDateTime(invitation.expires_at)}
                </p>
              </div>
              <RoleBadges roles={invitation.roles} />
              {invitation.status === "pending" ? (
                <div className="flex flex-wrap items-start gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Copy invitation link for ${invitation.email}`}
                    onClick={() => {
                      setCreated({ id: invitation.id, email: invitation.email });
                      void copyLink(invitation.id);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Copy link
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Revoke invitation for ${invitation.email}`}
                    onClick={() => {
                      revoke.reset();
                      setRevoking({ ...invitation, roles: [...invitation.roles] });
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {invitation.status === "accepted"
                    ? "Access granted on acceptance"
                    : "Link no longer grants access"}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title={status === "all" ? "No invitations yet" : `No ${status} invitations`}>
          Create an invitation to give a colleague access to this workspace.
        </EmptyState>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!invite.isPending) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invite a workspace member</DialogTitle>
            <DialogDescription>
              The link will be valid for seven days and can only be accepted by this verified email
              address.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              invite.mutate({ email: email.trim().toLowerCase(), roles });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Work email</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                disabled={invite.isPending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <RoleSelector roles={roles} onChange={setRoles} disabled={invite.isPending} />
            <ErrorMessage error={invite.error} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Share this link with the invited person. An email has not been sent.
            </p>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={invite.isPending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? "Creating invitation…" : "Create invitation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!revoking}
        onOpenChange={(value) => {
          if (!value && !revoke.isPending) setRevoking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              The pending invitation for {revoking?.email} will stop granting access. You can create
              a new invitation later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorMessage error={revoke.error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>Keep invitation</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => {
                if (revoking) revoke.mutate(revoking);
              }}
            >
              {revoke.isPending ? "Revoking…" : "Revoke invitation"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function GroupsPanel({
  groups,
  members,
  onRefresh,
}: {
  groups: AdminGroup[];
  members: AdminMember[];
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<AdminGroup | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const visible = groups.filter((group) => showArchived || group.is_active);
  return (
    <section aria-labelledby="groups-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="groups-title" className="text-base font-semibold">
            Assignment groups
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize active workspace members into service teams. Archived groups retain their
            record history.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden />
          Create group
        </Button>
      </div>
      <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        Include archived groups
      </label>
      {visible.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((group) => (
            <article
              key={group.id}
              className="flex flex-col rounded-lg border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="break-words text-sm font-semibold">{group.name}</h3>
                <StatusBadge active={group.is_active}>
                  {group.is_active ? "Active" : "Archived"}
                </StatusBadge>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {group.description || "No description provided."}
              </p>
              <p className="mt-4 text-xs font-medium">
                {group.member_ids.length} assigned{" "}
                {group.member_ids.length === 1 ? "member" : "members"}
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {group.member_ids.map((id) => {
                  const member = members.find((candidate) => candidate.user_id === id);
                  return (
                    <li
                      key={id}
                      className="max-w-full break-words rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {member?.display_name || member?.email || "Former workspace member"}
                      {member && !member.is_active ? " · Inactive" : ""}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-auto pt-5">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Edit group ${group.name}`}
                  onClick={() => setEditing({ ...group, member_ids: [...group.member_ids] })}
                >
                  Edit group
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No assignment groups to show">
          Create a group for a team, or include archived groups to manage an existing one.
        </EmptyState>
      )}
      {editing ? (
        <GroupEditor
          key={editing === "new" ? "new" : editing.id}
          group={editing === "new" ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </section>
  );
}

function GroupEditor({
  group,
  members,
  onClose,
  onRefresh,
}: {
  group: AdminGroup | null;
  members: AdminMember[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const activeMembers = members.filter((member) => member.is_active);
  const activeIds = new Set(activeMembers.map((member) => member.user_id));
  const [form, setForm] = useState<SaveGroupInput>({
    groupId: group?.id ?? null,
    name: group?.name ?? "",
    description: group?.description ?? "",
    isActive: group?.is_active ?? true,
    memberIds: group?.member_ids.filter((id) => activeIds.has(id)) ?? [],
    expectedVersion: group?.version ?? null,
  });
  const [search, setSearch] = useState("");
  const omittedInactive = group?.member_ids.filter((id) => !activeIds.has(id)).length ?? 0;
  const filtered = activeMembers.filter((member) =>
    `${member.display_name} ${member.email ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const save = useMutation({
    mutationFn: (input: SaveGroupInput) => saveGroup({ data: input }),
    onError: onRefresh,
    onSuccess: async () => {
      toast.success(group ? "Assignment group updated." : "Assignment group created.");
      await onRefresh();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group ? "Edit assignment group" : "Create assignment group"}</DialogTitle>
          <DialogDescription>
            Assign up to 500 active members from this workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(form);
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Group name</Label>
              <Input
                id="group-name"
                required
                minLength={2}
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                maxLength={1000}
                rows={3}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Describe the services this team supports"
              />
            </div>
            <label className="flex items-start gap-2.5 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium">Active assignment group</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Archived groups cannot receive new assignments. Existing record assignments are
                  retained.
                </span>
              </span>
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Group members</legend>
              <div className="space-y-1.5">
                <Label htmlFor="group-member-search" className="text-xs">
                  Find an active member
                </Label>
                <Input
                  id="group-member-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name or email"
                />
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {form.memberIds.length} of 500 selected · {filtered.length} matching active members
              </p>
              {omittedInactive ? (
                <p className="rounded-md border border-amber-700/20 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  {omittedInactive} inactive or former{" "}
                  {omittedInactive === 1 ? "member is" : "members are"} excluded and will be removed
                  from this group when saved.
                </p>
              ) : null}
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {filtered.length ? (
                  filtered.map((member) => (
                    <label
                      key={member.user_id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        checked={form.memberIds.includes(member.user_id)}
                        disabled={
                          !form.memberIds.includes(member.user_id) && form.memberIds.length >= 500
                        }
                        onChange={(event) =>
                          setForm({
                            ...form,
                            memberIds: event.target.checked
                              ? [...form.memberIds, member.user_id]
                              : form.memberIds.filter((id) => id !== member.user_id),
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="block break-words text-xs font-medium">
                          {member.display_name || "Unnamed member"}
                        </span>
                        <span className="mt-0.5 block break-all text-[11px] text-muted-foreground">
                          {member.email ?? "Email unavailable"}
                        </span>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    No active members match your search.
                  </p>
                )}
              </div>
            </fieldset>
          </fieldset>
          <ErrorMessage error={save.error} />
          {save.isError ? (
            <p className="text-xs text-muted-foreground">
              If the group changed elsewhere, cancel and reopen it to load its latest version.
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving group…" : group ? "Save group" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel({
  organization,
  onRefresh,
}: {
  organization: AdminOverview["organization"];
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<AdminOverview["organization"] | null>(null);
  return (
    <section aria-labelledby="settings-title" className="space-y-4">
      <div>
        <h2 id="settings-title" className="text-base font-semibold">
          Workspace settings
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the workspace identity and its default timezone.
        </p>
      </div>
      <div className="max-w-3xl rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
            <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="break-words font-semibold">{organization.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Current workspace</p>
          </div>
        </div>
        <dl className="mt-6 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Workspace name</dt>
            <dd className="mt-1 break-words text-sm font-medium">{organization.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Default timezone</dt>
            <dd className="mt-1 break-words font-mono text-sm">{organization.timezone}</dd>
          </div>
        </dl>
        <p className="mt-6 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
          Changing the default timezone does not change existing elapsed SLA clocks, deadlines, or
          individual profile timezones.
        </p>
        <Button className="mt-5" variant="outline" onClick={() => setEditing({ ...organization })}>
          Edit workspace settings
        </Button>
      </div>
      {editing ? (
        <SettingsEditor
          organization={editing}
          onClose={() => setEditing(null)}
          onRefresh={onRefresh}
        />
      ) : null}
    </section>
  );
}

function SettingsEditor({
  organization,
  onClose,
  onRefresh,
}: {
  organization: AdminOverview["organization"];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [form, setForm] = useState<UpdateWorkspaceInput>({
    name: organization.name,
    timezone: organization.timezone,
    expectedVersion: organization.admin_version,
  });
  const save = useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => updateWorkspaceSettings({ data: input }),
    onError: onRefresh,
    onSuccess: async () => {
      toast.success("Workspace settings updated.");
      await onRefresh();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit workspace settings</DialogTitle>
          <DialogDescription>These settings apply to the current workspace.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(form);
          }}
        >
          <fieldset disabled={save.isPending} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                required
                minLength={2}
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workspace-timezone">Default timezone</Label>
              <Input
                id="workspace-timezone"
                list="workspace-timezones"
                required
                maxLength={100}
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                aria-describedby="workspace-timezone-hint"
              />
              <datalist id="workspace-timezones">
                <option value="UTC" />
                <option value="Asia/Kolkata" />
                <option value="Asia/Singapore" />
                <option value="Europe/London" />
                <option value="America/New_York" />
                <option value="America/Los_Angeles" />
                <option value="Australia/Sydney" />
              </datalist>
              <p
                id="workspace-timezone-hint"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Use a valid timezone name such as Asia/Kolkata. Existing elapsed SLA clocks,
                deadlines, and profile timezones stay unchanged.
              </p>
            </div>
          </fieldset>
          <ErrorMessage error={save.error} />
          {save.isError ? (
            <p className="text-xs text-muted-foreground">
              If these settings changed elsewhere, cancel and reopen to review the latest version.
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving settings…" : "Save settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
