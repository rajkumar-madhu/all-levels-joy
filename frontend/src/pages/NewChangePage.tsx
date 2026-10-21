import { ArrowLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateChange } from "@/api/hooks";
import type { ChangeType, Risk } from "@/api/types";
import { Button, Field, FormError, Input, PageHeader, Panel, Select, StateMessage, Textarea } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import { CHANGE_CREATE_ROLES, hasAnyRole } from "@/lib/roles";
import { localWindowTimeToIso } from "@/lib/security-window";

const PLANS = [
  ["description", "What is changing"],
  ["businessJustification", "Why it is needed"],
  ["impactAssessment", "Impact assessment"],
  ["implementationPlan", "Implementation plan"],
  ["testPlan", "Test plan"],
  ["validationPlan", "How success is validated"],
  ["rollbackPlan", "Rollback plan"],
  ["rollbackTrigger", "Roll back when"],
  ["communicationPlan", "Communication plan"],
] as const;

export function NewChangePage() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const create = useCreateChange(workspace.id);
  const [windowError, setWindowError] = useState<string | null>(null);

  if (!hasAnyRole(workspace.roles, CHANGE_CREATE_ROLES))
    return <StateMessage kind="error">Only fulfillers, change managers, managers and admins can plan changes.</StateMessage>;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? "");
    let startAt: string;
    let endAt: string;
    try {
      // Converted where the user picked them, in their own timezone.
      startAt = localWindowTimeToIso(text("startAt"));
      endAt = localWindowTimeToIso(text("endAt"));
      if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("The change window must end after it starts.");
      setWindowError(null);
    } catch (err) {
      setWindowError(err instanceof Error ? err.message : "Choose a valid window.");
      return;
    }
    create.mutate(
      {
        title: text("title"),
        description: text("description"),
        changeType: text("changeType") as ChangeType,
        risk: text("risk") as Risk,
        implementationPlan: text("implementationPlan"),
        testPlan: text("testPlan"),
        rollbackPlan: text("rollbackPlan"),
        businessJustification: text("businessJustification"),
        impactAssessment: text("impactAssessment"),
        expectedOutageMinutes: Number(text("expectedOutageMinutes")),
        affectedCiIds: [],
        validationPlan: text("validationPlan"),
        rollbackTrigger: text("rollbackTrigger"),
        communicationPlan: text("communicationPlan"),
        startAt,
        endAt,
      },
      { onSuccess: (r) => navigate(`/changes/${r.id}`) },
    );
  };

  return (
    <>
      <Link to="/changes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Changes
      </Link>
      <PageHeader title="Plan a change" description="Normal and emergency changes go to the CAB for approval. Standard changes are pre-approved." />
      <Panel className="p-4">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
          <div className="md:col-span-2">
            <Field label="Title">
              <Input id="change-title" name="title" required minLength={5} maxLength={160} placeholder="Patch OpenSSL on api-gateway" />
            </Field>
          </div>
          <Field label="Type">
            <Select id="change-type" name="changeType" defaultValue="normal">
              <option value="standard">Standard (pre-approved)</option>
              <option value="normal">Normal (CAB approval)</option>
              <option value="emergency">Emergency (one CAB approver)</option>
            </Select>
          </Field>
          <Field label="Risk">
            <Select id="change-risk" name="risk" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
          <Field label="Window starts">
            <Input id="change-start" name="startAt" type="datetime-local" required />
          </Field>
          <Field label="Window ends">
            <Input id="change-end" name="endAt" type="datetime-local" required />
          </Field>
          <Field label="Expected outage (minutes)">
            <Input id="change-outage" name="expectedOutageMinutes" type="number" min={0} max={10080} defaultValue={0} required />
          </Field>
          <div />
          {PLANS.map(([name, label]) => (
            <Field key={name} label={label}>
              <Textarea id={`change-${name}`} name={name} required minLength={5} maxLength={6000} rows={3} />
            </Field>
          ))}
          <div className="grid gap-2 md:col-span-2">
            {windowError && <p role="alert" className="text-sm text-destructive">{windowError}</p>}
            <FormError error={create.error} />
            <div className="flex justify-end gap-2">
              <Link to="/changes" className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm hover:bg-accent ">Cancel</Link>
              <Button type="submit" busy={create.isPending}>Submit change</Button>
            </div>
          </div>
        </form>
      </Panel>
    </>
  );
}
