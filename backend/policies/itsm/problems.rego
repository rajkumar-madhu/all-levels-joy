# Problem management and knowledge authoring.
package itsm.authz

import rego.v1

# Legacy requireProblemRole / canRunProblems (problem.functions.ts, itsm-shared.ts).
problem_roles := {"service_desk", "fulfiller", "manager", "admin", "change_manager"}

# public.can_author_knowledge() and the legacy saveKnowledgeArticle role check.
knowledge_author_roles := {"service_desk", "fulfiller", "manager", "admin"}

# Problems are visible to workspace staff (RLS: can_manage).
allow if {
	input.action == "problem.read"
	is_member
	has_any(staff_roles)
}

allow if {
	input.action == "problem.run"
	is_member
	has_any(problem_roles)
}

allow if {
	input.action == "knowledge.author"
	is_member
	has_any(knowledge_author_roles)
}
