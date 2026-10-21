import { clsx } from "clsx";
import { Copy, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  ADMIN_ROLES,
  useAdministration,
  useInviteMember,
  useRevokeInvitation,
  useSaveGroup,
  useUpdateMember,
  useUpdateWorkspaceSettings,
  type AdminGroup,
  type AdminMember,
  type AdminOverview,
  type AdminRole,
} from "@/api/admin";
import { Badge, Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea, th } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { formatDateTime, ROLE_LABELS } from "@/lib/format";
import { invitationLink } from "@/lib/invitations";
import { timeZones } from "@/lib/timezones";

// Same wording as the existing administration screen.
const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
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
const TABS = [
  ["members", "Members"],
  ["invitations", "Invitations"],
  ["groups", "Assignment groups"],
  ["workspace", "Workspace settings"],
] as const;
type Tab = (typeof TABS)[number][0];

export function AdministrationPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([key]) => key === params.get("tab"))?.[0] ?? "members") as Tab;
  const isAdmin = workspace.roles.includes("admin");
  const overview = useAdministration(workspace.id);

  if (!isAdmin) return <StateMessage kind="error">Administration is available to workspace administrators only.</StateMessage>;

  return (
    <>
      <PageHeader
        eyebrow="Governance and knowledge"
        title="Administration"
        description="Invite people, manage their access and roles, organise assignment groups, and edit workspace settings. Every change is checked again in the database and recorded in the audit trail."
      />
      <div role="tablist" aria-label="Administration sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams({ tab: key }, { replace: true })}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              tab === key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {overview.isPending ? (
        <StateMessage kind="loading">Loading administration…</StateMessage>
      ) : overview.isError ? (
        <StateMessage kind="error">{overview.error.message}</StateMessage>
      ) : tab === "members" ? (
        <Members orgId={workspace.id} overview={overview.data} />
      ) : tab === "invitations" ? (
        <Invitations orgId={workspace.id} overview={overview.data} />
      ) : tab === "groups" ? (
        <Groups orgId={workspace.id} overview={overview.data} />
      ) : (
        <WorkspaceSettings orgId={workspace.id} overview={overview.data} />
      )}
    </>
  );
}

function RolePicker({ value, onChange, idPrefix }: { value: AdminRole[]; onChange: (roles: AdminRole[]) => void; idPrefix: string }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">Roles</legend>
      {ADMIN_ROLES.map((role) => (
        <label key={role} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
          <input
            id={`${idPrefix}-${role}`}
            type="checkbox"
            className="mt-0.5"
            checked={role === "requester" || value.includes(role)}
            disabled={role === "requester"}
            onChange={(e) => onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))}
          />
          <span>
            <span className="block text-xs font-medium">{ROLE_LABELS[role]}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Requester is the baseline role and is always kept. */
const withRequester = (roles: AdminRole[]): AdminRole[] => ["requester", ...roles.filter((r) => r !== "requester")];

function Members({ orgId, overview }: { orgId: string; overview: AdminOverview }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("active");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminMember | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = overview.members.filter(
    (m) =>
      (status === "all" || (status === "active") === m.is_active) &&
      (!q || m.display_name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            id="member-search"
            aria-label="Search members"
            placeholder="Search by name or email"
            className="max-w-sm"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <Select id="member-status" aria-label="Access" className="w-40!" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Active access</option>
            <option value="inactive">Disabled access</option>
            <option value="all">Everyone</option>
          </Select>
        </div>
        {rows.length === 0 ? (
          <StateMessage kind="empty">No members match your filters.</StateMessage>
        ) : (
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[40rem]">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>Member</th>
                  <th className={th}>Roles</th>
                  <th className={th}>Access</th>
                  <th className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-accent">
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">{m.display_name}</span>
                      <span className="text-xs text-muted-foreground">{m.email}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r) => <Badge key={r} tone={r === "admin" ? "info" : "neutral"}>{ROLE_LABELS[r] ?? r}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={m.is_active ? "good" : "muted"}>{m.is_active ? "Active" : "Disabled"}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="secondary" onClick={() => setEditing(m)}>Manage</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {filtered.length} matching of {overview.members.length} members · {PAGE_SIZE} per page
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" aria-label="Previous members page" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</Button>
            <span>{current} / {pages}</span>
            <Button variant="secondary" aria-label="Next members page" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</Button>
          </div>
        </div>
      </div>
      {editing && <MemberEditor key={editing.id + editing.version} orgId={orgId} member={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MemberEditor({ orgId, member, onClose }: { orgId: string; member: AdminMember; onClose: () => void }) {
  const update = useUpdateMember(orgId);
  const [roles, setRoles] = useState<AdminRole[]>(withRequester(member.roles));
  const [active, setActive] = useState(member.is_active);
  const losingApprover = (["manager", "admin", "change_manager", "cab_member"] as AdminRole[]).some(
    (r) => member.roles.includes(r) && (!roles.includes(r) || !active),
  );

  return (
    <Panel className="grid gap-4 p-4 lg:sticky lg:top-20">
      <div>
        <h2 className="font-semibold">{member.display_name}</h2>
        <p className="text-xs text-muted-foreground">{member.email} · member since {formatDateTime(member.created_at)}</p>
      </div>
      <RolePicker idPrefix={`member-${member.user_id}`} value={roles} onChange={(r) => setRoles(withRequester(r))} />
      <label className="flex items-center gap-2 text-sm">
        <input id="member-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active access to this workspace
      </label>
      {!active && member.is_active && (
        <p className="text-sm text-warning-foreground">Disabling keeps their history but stops all access immediately.</p>
      )}
      {losingApprover && (
        <p className="text-sm text-warning-foreground">
          Removing approval roles or access can block approvals already waiting for this person.
        </p>
      )}
      <FormError error={update.error} />
      <div className="flex gap-2">
        <Button
          busy={update.isPending}
          onClick={() =>
            update.mutate(
              { userId: member.user_id, roles: withRequester(roles), isActive: active, expectedVersion: member.version },
              { onSuccess: onClose },
            )
          }
        >
          Save access
        </Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
      {update.isError && <p className="text-xs text-muted-foreground">If someone else changed this member, cancel and reopen to load the latest access.</p>}
    </Panel>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Invitations({ orgId, overview }: { orgId: string; overview: AdminOverview }) {
  const invite = useInviteMember(orgId);
  const revoke = useRevokeInvitation(orgId);
  const [roles, setRoles] = useState<AdminRole[]>(["requester"]);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = overview.invitations.filter((i) => showAll || i.status === "pending");

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    invite.mutate({ email, roles: withRequester(roles) }, { onSuccess: () => form.reset() });
  };
  const copy = async (id: string) => setCopied((await copyText(invitationLink(id, window.location.origin))) ? id : `failed:${id}`);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Panel className="p-4">
        <form className="grid gap-4" onSubmit={submit}>
          <h2 className="font-semibold">Invite someone</h2>
          <Field label="Email" hint="They must sign in with this verified email to accept. No email is sent; share the link yourself.">
            <Input id="invite-email" name="email" type="email" required maxLength={254} />
          </Field>
          <RolePicker idPrefix="invite" value={roles} onChange={(r) => setRoles(withRequester(r))} />
          <FormError error={invite.error} />
          {invite.data && (
            <div className="grid gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
              <p>Invitation created. Share this link; it expires in 7 days.</p>
              <Input id="invite-link" readOnly value={invitationLink(invite.data.id, window.location.origin)} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="secondary" onClick={() => void copy(invite.data.id)}>
                <Copy className="size-4" /> {copied === invite.data.id ? "Copied" : "Copy link"}
              </Button>
            </div>
          )}
          <div>
            <Button type="submit" busy={invite.isPending}><Plus className="size-4" /> Create invitation</Button>
          </div>
        </form>
      </Panel>
      <div className="grid gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input id="invite-show-all" type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show accepted, revoked and expired invitations
        </label>
        <FormError error={revoke.error} />
        {copied?.startsWith("failed:") && (
          <p role="alert" className="text-sm text-destructive">Unable to copy the link. Select it in the invitation form and copy it manually.</p>
        )}
        {visible.length === 0 ? (
          <StateMessage kind="empty">{showAll ? "No invitations yet." : "No pending invitations."}</StateMessage>
        ) : (
          <Panel className="overflow-x-auto">
            <table className="w-full min-w-[40rem]">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>Email</th>
                  <th className={th}>Roles</th>
                  <th className={th}>Status</th>
                  <th className={th}>Expires</th>
                  <th className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((i) => (
                  <tr key={i.id} className="hover:bg-accent">
                    <td className="px-4 py-2.5">{i.email}</td>
                    <td className="px-4 py-2.5 text-xs">{i.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ")}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={i.status === "pending" ? "warn" : i.status === "accepted" ? "good" : "muted"}>{i.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(i.expires_at)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {i.status === "pending" && (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => void copy(i.id)}>{copied === i.id ? "Copied" : "Copy link"}</Button>
                          <Button variant="danger" busy={revoke.isPending} onClick={() => revoke.mutate({ id: i.id, expectedVersion: i.version })}>
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Groups({ orgId, overview }: { orgId: string; overview: AdminOverview }) {
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<AdminGroup | "new" | null>(null);
  const names = new Map(overview.members.map((m) => [m.user_id, m.display_name]));
  const visible = overview.groups.filter((g) => showArchived || g.is_active);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input id="group-show-archived" type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived groups
          </label>
          <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New group</Button>
        </div>
        {visible.length === 0 ? (
          <StateMessage kind="empty">No assignment groups yet.</StateMessage>
        ) : (
          <ul className="grid gap-2">
            {visible.map((g) => (
              <li key={g.id}>
                <Panel className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {g.name} {!g.is_active && <Badge tone="muted">Archived</Badge>}
                    </p>
                    {g.description && <p className="text-sm text-muted-foreground">{g.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {g.member_ids.length ? g.member_ids.map((id) => names.get(id) ?? "Former member").join(", ") : "No members"}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => setEditing(g)}>Edit</Button>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && (
        <GroupEditor
          key={editing === "new" ? "new" : editing.id + editing.version}
          orgId={orgId}
          group={editing === "new" ? null : editing}
          members={overview.members}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function GroupEditor({ orgId, group, members, onClose }: { orgId: string; group: AdminGroup | null; members: AdminMember[]; onClose: () => void }) {
  const save = useSaveGroup(orgId);
  const active = members.filter((m) => m.is_active);
  const activeIds = new Set(active.map((m) => m.user_id));
  const [selected, setSelected] = useState<string[]>(group?.member_ids.filter((id) => activeIds.has(id)) ?? []);
  const dropped = (group?.member_ids.length ?? 0) - (group?.member_ids.filter((id) => activeIds.has(id)).length ?? 0);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    save.mutate(
      {
        groupId: group?.id ?? null,
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        isActive: form.get("active") === "on",
        memberIds: selected,
        ...(group ? { expectedVersion: group.version } : {}),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Panel className="p-4 lg:sticky lg:top-20">
      <form className="grid gap-4" onSubmit={submit}>
        <h2 className="font-semibold">{group ? `Edit ${group.name}` : "New assignment group"}</h2>
        <Field label="Name">
          <Input id="group-name" name="name" defaultValue={group?.name ?? ""} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Description">
          <Textarea id="group-description" name="description" defaultValue={group?.description ?? ""} maxLength={1000} rows={2} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input id="group-active" type="checkbox" name="active" defaultChecked={group?.is_active ?? true} />
          Active (archived groups keep existing assignments but cannot receive new ones)
        </label>
        <fieldset className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-border p-2">
          <legend className="px-1 text-sm font-medium">Members ({selected.length})</legend>
          {active.map((m) => (
            <label key={m.user_id} className="flex items-center gap-2 text-sm">
              <input
                id={`group-member-${m.user_id}`}
                type="checkbox"
                checked={selected.includes(m.user_id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, m.user_id] : selected.filter((id) => id !== m.user_id))}
              />
              {m.display_name} <span className="text-xs text-muted-foreground">{m.email}</span>
            </label>
          ))}
        </fieldset>
        {dropped > 0 && (
          <p className="text-sm text-warning-foreground">
            {dropped} inactive or former {dropped === 1 ? "member" : "members"} will be removed from this group when you save.
          </p>
        )}
        <FormError error={save.error} />
        <div className="flex gap-2">
          <Button type="submit" busy={save.isPending}>{group ? "Save group" : "Create group"}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}

function WorkspaceSettings({ orgId, overview }: { orgId: string; overview: AdminOverview }) {
  const update = useUpdateWorkspaceSettings(orgId);
  const org = overview.organization;
  const [saved, setSaved] = useState(false);
  return (
    <Panel className="max-w-xl p-5">
      <form
        key={org.admin_version}
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setSaved(false);
          update.mutate(
            { name: String(form.get("name") ?? ""), timezone: String(form.get("timezone") ?? ""), expectedVersion: org.admin_version },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        <Field label="Workspace name">
          <Input id="workspace-name" name="name" defaultValue={org.name} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Default timezone" hint="Does not recalculate existing SLA deadlines or change people's own timezones.">
          <Select id="workspace-timezone" name="timezone" defaultValue={org.timezone}>
            {timeZones(org.timezone).map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
        <FormError error={update.error} />
        {saved && <p role="status" className="text-sm text-success">Workspace settings saved.</p>}
        <div>
          <Button type="submit" busy={update.isPending}>Save settings</Button>
        </div>
      </form>
    </Panel>
  );
}
