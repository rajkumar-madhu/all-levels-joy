# API authorization for the ITSM workspace (PBAC).
#
# Input (built by apps/core/policy.py):
#   subject.roles   {org_id: [app_role, ...]} for ACTIVE memberships only
#   action          e.g. "security.board.read"
#   resource.org_id workspace the request targets
#
# These rules decide who may call an endpoint. Row-level security and the legacy security-definer
# functions still enforce row visibility and lifecycle rules underneath; keep each rule in step with
# the SQL helper named beside it.
package itsm.authz

import rego.v1

default allow := false

# public.can_manage(): every role except a plain requester.
staff_roles := {"service_desk", "fulfiller", "change_manager", "cab_member", "cmdb_manager", "manager", "admin"}

member_actions := {
	"incident.list",
	"incident.read",
	"incident.create_self_service",
	"knowledge.read",
}

staff_actions := {
	"security.board.read",
	"security.finding.create",
	"security.finding.transition",
	"security.exception.request",
	"security.exception.decide",
}

org_roles := object.get(input.subject.roles, input.resource.org_id, null)

# public.is_org_member(): an active membership, even with no extra roles.
is_member if org_roles != null

has_any(allowed) if {
	some role in org_roles
	role in allowed
}

allow if {
	input.action in member_actions
	is_member
}

allow if {
	input.action in staff_actions
	is_member
	has_any(staff_roles)
}
