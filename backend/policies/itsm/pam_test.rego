package itsm.pam_test

import rego.v1

import data.itsm.authz

org := "10000000-0000-0000-0000-000000000001"

other := "20000000-0000-0000-0000-000000000002"

req(roles, action, org_id) := {
	"subject": {"id": "u1", "roles": roles},
	"action": action,
	"resource": {"org_id": org_id},
}

test_staff_read_and_request if {
	authz.allow with input as req({org: ["fulfiller"]}, "pam.read", org)
	authz.allow with input as req({org: ["cab_member"]}, "pam.request", org)
	not authz.allow with input as req({org: ["requester"]}, "pam.read", org)
	not authz.allow with input as req({org: ["requester"]}, "pam.request", org)
}

test_custodians_manage_and_decide if {
	authz.allow with input as req({org: ["manager"]}, "pam.manage", org)
	authz.allow with input as req({org: ["admin"]}, "pam.decide", org)
	not authz.allow with input as req({org: ["service_desk"]}, "pam.manage", org)
	not authz.allow with input as req({org: ["change_manager"]}, "pam.decide", org)
	not authz.allow with input as req({org: ["admin"]}, "pam.manage", other)
}
