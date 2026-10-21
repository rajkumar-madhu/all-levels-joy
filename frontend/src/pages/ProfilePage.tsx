import { useState, type FormEvent } from "react";
import { useProfile, useUpdateProfile, type Profile } from "@/api/admin";
import { Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage } from "@/components/ui";
import { timeZones } from "@/lib/timezones";

export function ProfilePage() {
  const profile = useProfile();
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Update your name, contact details, department, locale, timezone, and notification preferences."
      />
      {profile.isPending ? (
        <StateMessage kind="loading">Loading your profile…</StateMessage>
      ) : profile.isError ? (
        <StateMessage kind="error">{profile.error.message}</StateMessage>
      ) : (
        <ProfileForm key={JSON.stringify(profile.data)} profile={profile.data} />
      )}
    </>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const zones = timeZones(profile.timezone);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "").trim();
    setSaved(false);
    update.mutate(
      {
        displayName: text("displayName"),
        phone: text("phone"),
        jobTitle: text("jobTitle"),
        department: text("department"),
        locale: text("locale"),
        timezone: text("timezone"),
        emailDigest: form.get("emailDigest") === "on",
      },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <Panel className="max-w-3xl p-5">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <div className="sm:col-span-2">
          <Field label="Email" hint="Managed by your sign-in account.">
            <Input id="profile-email" value={profile.email ?? ""} disabled readOnly />
          </Field>
        </div>
        <Field label="Display name">
          <Input id="profile-name" name="displayName" defaultValue={profile.display_name ?? ""} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Phone">
          <Input id="profile-phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={40} />
        </Field>
        <Field label="Job title">
          <Input id="profile-title" name="jobTitle" defaultValue={profile.job_title ?? ""} maxLength={120} />
        </Field>
        <Field label="Department">
          <Input id="profile-department" name="department" defaultValue={profile.department ?? ""} maxLength={120} />
        </Field>
        <Field label="Locale" hint="For example en, en-IN.">
          <Input id="profile-locale" name="locale" defaultValue={profile.locale ?? "en"} required minLength={2} maxLength={20} />
        </Field>
        <Field label="Timezone">
          <Select id="profile-timezone" name="timezone" defaultValue={profile.timezone ?? "UTC"}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input id="profile-digest" type="checkbox" name="emailDigest" defaultChecked={profile.preferences?.emailDigest ?? true} />
          Send me an email digest of my notifications
        </label>
        <div className="grid gap-2 sm:col-span-2">
          <FormError error={update.error} />
          {saved && <p role="status" className="text-sm text-success">Profile saved.</p>}
          <div>
            <Button type="submit" busy={update.isPending}>Save profile</Button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
