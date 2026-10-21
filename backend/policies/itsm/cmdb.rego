# Assets & CMDB, catalogue administration, request tasks, change links and operator-raised incidents.
# Each rule mirrors the legacy server-function role check or RLS policy named beside it.
package itsm.authz

import rego.v1

# ci_manage RLS policy and legacy saveConfigurationItem.
cmdb_manage_roles := {"cmdb_manager", "admin"}

# Legacy updateCatalogRouting.
catalog_manage_roles := {"manager", "admin"}

cmdb_member_actions := {
	"service.read", # services_read
	"change.link.read", # "Members read change links"
}

# Workspace staff (public.can_manage) only.
cmdb_staff_actions := {
	"asset.read", # ci_read
	"request.task.read", # request_tasks_read
	"request.task.manage", # request_tasks_manage
	"change.link.manage", # change_links insert/delete
	"incident.create", # incidents_create (operator-raised)
}

allow if {
	input.action in cmdb_member_actions
	is_member
}

allow if {
	input.action in cmdb_staff_actions
	is_member
	has_any(staff_roles)
}

allow if {
	input.action == "asset.manage"
	is_member
	has_any(cmdb_manage_roles)
}

allow if {
	input.action == "catalog.manage"
	is_member
	has_any(catalog_manage_roles)
}
