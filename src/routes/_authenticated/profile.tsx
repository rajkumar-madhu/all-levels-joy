import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, WorkspaceLoading, useWorkspace } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { updateProfile } from "@/lib/itsm.functions";
import { ROLE_LABELS, type AppRole } from "@/lib/itsm-shared";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "My profile — WeCrew ITSM" },
      {
        name: "description",
        content: "Update your name, contact details, department, locale, timezone, and notification preferences.",
      },
      { property: "og:title", content: "My profile — WeCrew ITSM" },
      { property: "og:description", content: "Personal details, preferences, and password management." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const data = workspace.data;
  const roles = (data?.roles ?? []) as AppRole[];

  const [form, setForm] = useState({
    displayName: "",
    phone: "",
    jobTitle: "",
    department: "",
    locale: "en",
    timezone: "UTC",
    emailDigest: true,
  });
  const [passwords, setPasswords] = useState({ current: "", next: "" });

  useEffect(() => {
    const profile = data?.profile;
    if (!profile) return;
    const prefs = (profile.preferences ?? {}) as { emailDigest?: boolean };
    setForm({
      displayName: profile.display_name ?? "",
      phone: profile.phone ?? "",
      jobTitle: profile.job_title ?? "",
      department: profile.department ?? "",
      locale: profile.locale ?? "en",
      timezone: profile.timezone ?? "UTC",
      emailDigest: prefs.emailDigest ?? true,
    });
  }, [data?.profile]);

  const save = useMutation({
    mutationFn: () => updateProfile({ data: form }),
    onSuccess: async () => {
      toast.success("Profile updated.");
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Your profile was not saved."),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({
        password: passwords.next,
        current_password: passwords.current,
      } as { password: string; current_password: string });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password changed.");
      setPasswords({ current: "", next: "" });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The password was not changed."),
  });

  return (
    <AppShell workspace={data}>
      <PageHeader
        eyebrow="Account"
        title="My profile"
        description="These details appear on the records you raise and drive how we contact you."
      />

      {workspace.isPending ? (
        <div className="mt-6">
          <WorkspaceLoading />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <form
            className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-name">Display name</Label>
              <Input
                id="p-name"
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                required
                minLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-title">Job title</Label>
              <Input
                id="p-title"
                value={form.jobTitle}
                onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-dept">Department</Label>
              <Input
                id="p-dept"
                value={form.department}
                onChange={(event) => setForm({ ...form, department: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-phone">Contact number</Label>
              <Input
                id="p-phone"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-locale">Language</Label>
              <Input
                id="p-locale"
                value={form.locale}
                onChange={(event) => setForm({ ...form, locale: event.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="p-tz">Timezone</Label>
              <Input
                id="p-tz"
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
              <input
                type="checkbox"
                checked={form.emailDigest}
                onChange={(event) => setForm({ ...form, emailDigest: event.target.checked })}
              />
              Send me a daily digest of my open records
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                Save profile
              </Button>
            </div>
          </form>

          <div className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Assigned roles</h2>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {roles.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No roles assigned yet.</li>
                ) : (
                  roles.map((role) => (
                    <li
                      key={role}
                      className="rounded border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                    >
                      {ROLE_LABELS[role]}
                    </li>
                  ))
                )}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Roles decide which queues and actions you see. An administrator manages them.
              </p>
            </div>

            <form
              className="space-y-3 rounded-lg border border-border bg-card p-5"
              onSubmit={(event) => {
                event.preventDefault();
                changePassword.mutate();
              }}
            >
              <h2 className="text-sm font-semibold text-foreground">Change password</h2>
              <div className="space-y-1.5">
                <Label htmlFor="pw-current">Current password</Label>
                <Input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={passwords.current}
                  onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-next">New password</Label>
                <Input
                  id="pw-next"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={passwords.next}
                  onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
                  required
                />
              </div>
              <Button type="submit" variant="outline" disabled={changePassword.isPending}>
                Update password
              </Button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
