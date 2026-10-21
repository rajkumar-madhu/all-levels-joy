package itsm.insights_test

import rego.v1

import data.itsm.authz

org := "10000000-0000-0000-0000-000000000001"

other := "20000000-0000-0000-0000-000000000002"

req(roles, action, org_id) := {
	"subject": {"id": "u1", "roles": roles},
	"action": action,
	"resource": {"org_id": org_id},
}

test_members_read_sla_insights_and_search if {
	authz.allow with input as req({org: ["requester"]}, "sla.read", org)
	authz.allow with input as req({org: ["requester"]}, "insights.read", org)
	authz.allow with input as req({org: ["requester"]}, "search.read", org)
	authz.allow with input as req({org: []}, "activity.read", org)
}

test_members_attach_files if {
	authz.allow with input as req({org: ["requester"]}, "attachment.create", org)
	authz.allow with input as req({org: ["requester"]}, "attachment.read", org)
}

test_non_members_and_other_workspaces_are_denied if {
	not authz.allow with input as req({}, "sla.read", org)
	not authz.allow with input as req({org: ["admin"]}, "attachment.read", other)
}
