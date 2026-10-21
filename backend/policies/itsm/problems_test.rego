package itsm.problems_test

import rego.v1

import data.itsm.authz

org := "10000000-0000-0000-0000-000000000001"

other := "20000000-0000-0000-0000-000000000002"

req(roles, action, org_id) := {
	"subject": {"id": "u1", "roles": roles},
	"action": action,
	"resource": {"org_id": org_id},
}

test_problems_are_staff_only if {
	authz.allow with input as req({org: ["cab_member"]}, "problem.read", org)
	not authz.allow with input as req({org: ["requester"]}, "problem.read", org)
}

test_running_problems_needs_problem_roles if {
	authz.allow with input as req({org: ["change_manager"]}, "problem.run", org)
	not authz.allow with input as req({org: ["cab_member"]}, "problem.run", org)
	not authz.allow with input as req({org: ["cmdb_manager"]}, "problem.run", org)
	not authz.allow with input as req({org: ["admin"]}, "problem.run", other)
}

test_knowledge_authors if {
	authz.allow with input as req({org: ["fulfiller"]}, "knowledge.author", org)
	not authz.allow with input as req({org: ["change_manager"]}, "knowledge.author", org)
	not authz.allow with input as req({org: ["requester"]}, "knowledge.author", org)
}
