# Administration, audit trail, profile, notifications and invitation acceptance.
# Part of package itsm.authz; see authz.rego for the input shape and shared helpers.
package itsm.authz

import rego.v1

# The itsm_admin_* functions and itsm_admin_overview require an active administrator.
admin_actions := {
	"admin.read",
	"admin.invite",
	"admin.revoke_invitation",
	"admin.update_member",
	"admin.save_group",
	"admin.update_workspace",
}

# Your own notifications in a workspace you belong to (notifications_own / notifications_update).
notification_actions := {"notification.read", "notification.update"}

# Not tied to a workspace: your own profile, and an invitation you open before you are a member.
# The database checks the invitation's verified email; the API also checks the token's verified email.
self_actions := {"profile.read", "profile.update", "invitation.read", "invitation.accept"}

allow if {
	input.action in admin_actions
	is_member
	has_any({"admin"})
}

allow if {
	input.action in notification_actions
	is_member
}

# audit_read: operational audit for staff; administration evidence is narrowed to admins by RLS.
allow if {
	input.action == "audit.read"
	is_member
	has_any(staff_roles)
}

allow if {
	input.action in self_actions
	is_string(input.subject.id)
	input.subject.id != ""
}
