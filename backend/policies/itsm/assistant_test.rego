package itsm.authz_test

import rego.v1

import data.itsm.authz

portal_req(email, verified) := {
	"subject": {"id": "u1", "email": email, "email_verified": verified, "roles": {}},
	"action": "portal.use",
	"resource": {"org_id": org, "portal_domain": "wecrew.in"},
}

test_members_use_the_assistant if {
	authz.allow with input as req({org: ["requester"]}, "assistant.use", org)
	not authz.allow with input as req({}, "assistant.use", org)
}

test_only_admins_read_integrations if {
	authz.allow with input as req({org: ["admin"]}, "integrations.read", org)
	not authz.allow with input as req({org: ["manager", "service_desk"]}, "integrations.read", org)
	authz.allow with input as req({org: ["admin"]}, "integrations.test", org)
	not authz.allow with input as req({org: ["manager"]}, "integrations.test", org)
}

test_portal_needs_a_confirmed_domain_account if {
	authz.allow with input as portal_req("Asha@WeCrew.in", true)
	not authz.allow with input as portal_req("asha@wecrew.in", false)
	not authz.allow with input as portal_req("asha@gmail.com", true)
	not authz.allow with input as portal_req("asha@notwecrew.in", true)
}
