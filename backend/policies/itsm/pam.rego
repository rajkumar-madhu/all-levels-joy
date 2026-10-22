# Privileged access (PAM).
package itsm.authz

import rego.v1

# public.pam_is_custodian(): managers and administrators look after the vault and decide access.
pam_custodian_roles := {"manager", "admin"}

# Secret metadata and access requests are for workspace staff (RLS: can_manage).
allow if {
	input.action in {"pam.read", "pam.request"}
	is_member
	has_any(staff_roles)
}

allow if {
	input.action in {"pam.manage", "pam.decide"}
	is_member
	has_any(pam_custodian_roles)
}
