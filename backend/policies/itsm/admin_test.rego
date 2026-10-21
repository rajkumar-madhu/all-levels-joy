package itsm.admin_test

import rego.v1

import data.itsm.authz

org := "10000000-0000-0000-0000-000000000001"

other := "20000000-0000-0000-0000-000000000002"

req(roles, action, org_id) := {
	"subject": {"id": "u1", "roles": roles},
	"action": action,
	"resource": {"org_id": org_id},
}

test_only_admins_administer if {
	authz.allow with input as req({org: ["requester", "admin"]}, "admin.invite", org)
	not authz.allow with input as req({org: ["requester", "manager"]}, "admin.invite", org)
	not authz.allow with input as req({org: ["admin"]}, "admin.read", other)
}

test_audit_is_for_staff if {
	authz.allow with input as req({org: ["cab_member"]}, "audit.read", org)
	not authz.allow with input as req({org: ["requester"]}, "audit.read", org)
}

test_members_read_their_notifications if {
	authz.allow with input as req({org: ["requester"]}, "notification.read", org)
	not authz.allow with input as req({}, "notification.read", org)
}

test_invitation_needs_no_membership if {
	authz.allow with input as {"subject": {"id": "u1", "roles": {}}, "action": "invitation.accept", "resource": {}}
	not authz.allow with input as {"subject": {"id": "", "roles": {}}, "action": "invitation.accept", "resource": {}}
}

test_profile_is_self_service if {
	authz.allow with input as {"subject": {"id": "u1", "roles": {}}, "action": "profile.update", "resource": {}}
}
