# SLA performance, incident insights, activity timelines, attachments and search.
#
# The legacy app showed these screens to every active member (requiresManage: false); what each person
# sees is decided by row-level security underneath (requesters: their own tickets; staff: the workspace).
package itsm.authz

import rego.v1

insights_member_actions := {
	"sla.read",
	"insights.read",
	"activity.read",
	"search.read",
	"attachment.read",
	"attachment.create",
}

allow if {
	input.action in insights_member_actions
	is_member
}
