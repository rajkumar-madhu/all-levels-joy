package itsm.authz_test

import rego.v1

import data.itsm.authz

org := "10000000-0000-0000-0000-000000000001"

other := "20000000-0000-0000-0000-000000000002"

req(roles, action, org_id) := {
	"subject": {"id": "u1", "roles": roles},
	"action": action,
	"resource": {"org_id": org_id},
}

test_requester_reads_incidents if {
	authz.allow with input as req({org: ["requester"]}, "incident.list", org)
}

test_member_without_roles_is_still_member if {
	authz.allow with input as req({org: []}, "knowledge.read", org)
}

test_requester_cannot_open_security_board if {
	not authz.allow with input as req({org: ["requester"]}, "security.board.read", org)
}

test_staff_opens_security_board if {
	authz.allow with input as req({org: ["requester", "service_desk"]}, "security.board.read", org)
}

test_roles_do_not_cross_workspaces if {
	not authz.allow with input as req({org: ["admin"]}, "security.board.read", other)
}

test_non_member_denied if {
	not authz.allow with input as req({}, "incident.list", org)
}

test_unknown_action_denied if {
	not authz.allow with input as req({org: ["admin"]}, "incident.delete_everything", org)
}
