# Support assistant, customer portal and integrations status.
package itsm.authz

import rego.v1

# Conversations are per user; RLS keeps them private (ai_chat_* own-row policies).
allow if {
	input.action == "assistant.use"
	is_member
}

# Legacy integration-status: administrators only (has_role(..., 'admin', ...)). Sending a test message or
# email through a configured channel is administrators only too.
allow if {
	input.action in {"integrations.read", "integrations.test"}
	is_member
	has_any({"admin"})
}

# Legacy portal_allowed(): a confirmed account on the portal email domain, member or not.
# The portal_* SQL functions re-check the same rule.
allow if {
	input.action == "portal.use"
	input.subject.email_verified == true
	endswith(lower(input.subject.email), concat("", ["@", lower(input.resource.portal_domain)]))
}
