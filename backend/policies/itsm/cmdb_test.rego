package itsm.authz_test

import rego.v1

import data.itsm.authz

test_staff_read_assets_but_only_cmdb_owners_write if {
	authz.allow with input as req({org: ["service_desk"]}, "asset.read", org)
	not authz.allow with input as req({org: ["service_desk"]}, "asset.manage", org)
	authz.allow with input as req({org: ["cmdb_manager"]}, "asset.manage", org)
	not authz.allow with input as req({org: ["requester"]}, "asset.read", org)
}

test_catalogue_admin_needs_manager_or_admin if {
	authz.allow with input as req({org: ["manager"]}, "catalog.manage", org)
	not authz.allow with input as req({org: ["service_desk"]}, "catalog.manage", org)
}

test_members_read_services_and_change_links if {
	authz.allow with input as req({org: ["requester"]}, "service.read", org)
	authz.allow with input as req({org: ["requester"]}, "change.link.read", org)
	not authz.allow with input as req({org: ["requester"]}, "change.link.manage", org)
}

test_operator_incidents_and_tasks_are_staff_only if {
	authz.allow with input as req({org: ["fulfiller"]}, "incident.create", org)
	not authz.allow with input as req({org: ["requester"]}, "incident.create", org)
	not authz.allow with input as req({org: ["requester"]}, "request.task.manage", org)
	not authz.allow with input as req({org: ["cmdb_manager"]}, "incident.create", other)
}
