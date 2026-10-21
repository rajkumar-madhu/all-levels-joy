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

test_requester_raises_requests_but_not_changes if {
	authz.allow with input as req({org: ["requester"]}, "request.create", org)
	not authz.allow with input as req({org: ["requester"]}, "change.create", org)
	authz.allow with input as req({org: ["fulfiller"]}, "change.create", org)
}

test_only_fulfilment_staff_update_requests if {
	authz.allow with input as req({org: ["fulfiller"]}, "request.update", org)
	not authz.allow with input as req({org: ["cab_member"]}, "request.update", org)
	not authz.allow with input as req({org: ["requester"]}, "request.update", org)
}

test_only_change_managers_move_changes if {
	authz.allow with input as req({org: ["change_manager"]}, "change.update", org)
	not authz.allow with input as req({org: ["service_desk"]}, "change.update", org)
	not authz.allow with input as req({org: ["change_manager"]}, "change.update", other)
}

test_incident_updates_need_operator_roles if {
	authz.allow with input as req({org: ["service_desk"]}, "incident.update", org)
	not authz.allow with input as req({org: ["cab_member"]}, "incident.update", org)
	not authz.allow with input as req({org: ["requester"]}, "incident.update", org)
}

test_command_center_is_staff_only if {
	authz.allow with input as req({org: ["cab_member"]}, "major_incident.read", org)
	not authz.allow with input as req({org: ["requester"]}, "major_incident.read", org)
}

test_running_a_bridge_needs_problem_roles if {
	authz.allow with input as req({org: ["service_desk"]}, "major_incident.run", org)
	not authz.allow with input as req({org: ["cab_member"]}, "major_incident.run", org)
}
