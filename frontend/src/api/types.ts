export type Workspace = { id: string; name: string; slug: string | null; roles: string[]; is_staff: boolean };

export type Me = {
  user_id: string;
  email: string | null;
  profile: { display_name: string | null; avatar_url: string | null; job_title: string | null; timezone: string | null } | null;
  workspaces: Workspace[];
};

export type IncidentState = "new" | "open" | "in_progress" | "pending" | "resolved" | "closed" | "cancelled";

export type IncidentSummary = {
  id: string;
  number: string;
  title: string;
  state: IncidentState;
  priority: number | null;
  impact: number;
  urgency: number;
  category: string | null;
  contact_type: string | null;
  major_incident: boolean;
  sla_due_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Incident = IncidentSummary & {
  description: string | null;
  subcategory: string | null;
  on_hold_reason: string | null;
  close_code: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  first_responded_at: string | null;
  reopen_count: number;
};

export type NewIncident = {
  title: string;
  description: string;
  impact: number;
  urgency: number;
  category?: string;
  contactType?: "self_service" | "chat";
};

export type ArticleSummary = {
  id: string;
  number: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  status: string;
  version: number;
  published_at: string | null;
  updated_at: string;
};

export type Article = ArticleSummary & { content: string | null };

export type Severity = "critical" | "high" | "medium" | "low";
export type FindingState =
  | "requested"
  | "pending_approval"
  | "scheduled"
  | "remediating"
  | "delivered"
  | "closed"
  | "cancelled"
  | "risk_accepted";

export type Finding = {
  id: string;
  number: string;
  title: string;
  description: string | null;
  source: string | null;
  scanner_name: string | null;
  reference: string | null;
  asset_key: string | null;
  severity: Severity;
  state: FindingState;
  requester_id: string | null;
  approver_id: string | null;
  impact_assessment: string | null;
  fix_plan: string | null;
  test_plan: string | null;
  rollback_plan: string | null;
  rollback_trigger: string | null;
  window_start: string | null;
  window_end: string | null;
  due_at: string | null;
  approval_notes: string | null;
  delivery_outcome: string | null;
  change_id: string | null;
  incident_id: string | null;
  created_at: string;
};

export type SecurityException = {
  id: string;
  finding_id: string;
  justification: string;
  compensating_controls: string;
  expires_at: string;
  status: string;
  requested_by: string | null;
  decision_notes: string | null;
  created_at: string;
};

export type RecordRef = { id: string; number: string; title: string };

export type SecurityBoard = {
  findings: Finding[];
  exceptions: SecurityException[];
  changes: RecordRef[];
  incidents: RecordRef[];
};

/** Request bodies use the same camelCase fields the legacy server functions accepted. */
export type Transition =
  | {
      action: "submit";
      impactAssessment: string;
      fixPlan: string;
      testPlan: string;
      rollbackPlan: string;
      rollbackTrigger: string;
    }
  | { action: "approve"; notes?: string }
  | { action: "reject"; notes: string }
  | { action: "schedule"; windowStart: string; windowEnd: string }
  | { action: "start" }
  | {
      action: "deliver";
      outcome: "successful" | "partial" | "failed";
      validationResults: string;
      reviewNotes: string;
      rollbackUsed: boolean;
    }
  | { action: "close" }
  | { action: "cancel" }
  | { action: "link"; changeId?: string; incidentId?: string };

export type RecordState = IncidentState;

export type CatalogItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  delivery_days: number;
  approval_required: boolean;
  default_priority: number | null;
  group_name: string | null;
};

export type ApprovalLine = {
  id: string;
  approver_id: string;
  approver_name: string | null;
  status: "requested" | "approved" | "rejected" | "cancelled";
  decision_notes: string | null;
  decided_at: string | null;
};

export type ServiceRequestSummary = {
  id: string;
  number: string;
  title: string;
  state: RecordState;
  approval_status: "not_required" | "requested" | "approved" | "rejected";
  priority: number | null;
  due_at: string | null;
  awaiting_customer_since: string | null;
  created_at: string;
  updated_at: string;
  catalog_item_name: string | null;
  group_name: string | null;
};

export type ServiceRequest = ServiceRequestSummary & { description: string | null; approvals: ApprovalLine[] };

export type ChangeType = "standard" | "normal" | "emergency";
export type Risk = "low" | "medium" | "high" | "critical";

export type ChangeSummary = {
  id: string;
  number: string;
  title: string;
  change_type: ChangeType;
  risk: Risk;
  state: RecordState;
  approval_status: "not_required" | "requested" | "approved" | "rejected";
  start_at: string | null;
  end_at: string | null;
  expected_outage_minutes: number;
  service_name: string | null;
  created_at: string;
};

export type Change = ChangeSummary & {
  description: string | null;
  implementation_plan: string | null;
  test_plan: string | null;
  rollback_plan: string | null;
  business_justification: string | null;
  impact_assessment: string | null;
  validation_plan: string | null;
  rollback_trigger: string | null;
  communication_plan: string | null;
  actual_start_at: string | null;
  delivery_outcome: string | null;
  validation_results: string | null;
  rollback_used: boolean | null;
  pir_notes: string | null;
  approvals: ApprovalLine[];
};

export type NewChange = {
  title: string;
  description: string;
  changeType: ChangeType;
  risk: Risk;
  implementationPlan: string;
  testPlan: string;
  rollbackPlan: string;
  businessJustification: string;
  impactAssessment: string;
  expectedOutageMinutes: number;
  affectedCiIds: string[];
  validationPlan: string;
  rollbackTrigger: string;
  communicationPlan: string;
  startAt: string;
  endAt: string;
};

export type ChangeAction =
  | { action: "start" | "close" | "cancel" }
  | {
      action: "deliver";
      deliveryOutcome: "successful" | "successful_with_issues" | "failed" | "rolled_back";
      validationResults: string;
      pirNotes: string;
      rollbackUsed: boolean;
    };

export type MyApproval = {
  id: string;
  record_type: "request" | "change" | "knowledge";
  record_id: string;
  status: ApprovalLine["status"];
  decision_notes: string | null;
  decided_at: string | null;
  created_at: string;
  record_number: string | null;
  record_title: string | null;
  risk: Risk | null;
  change_type: ChangeType | null;
  start_at: string | null;
  end_at: string | null;
};
