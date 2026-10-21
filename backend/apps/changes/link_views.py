"""Links between changes and the incidents or problems they resolve (legacy change-links.functions.ts)."""

from django.http import Http404
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import execute, fetch_all, fetch_one
from apps.core.views import CallerAPIView

RECORD_TABLES = {"incident": "incidents", "problem": "problems"}


class LinkSerializer(serializers.Serializer):
    recordType = serializers.ChoiceField(choices=list(RECORD_TABLES))
    recordId = serializers.UUIDField()
    relation = serializers.ChoiceField(choices=["resolves", "caused_by", "related"], default="resolves")


def change_links(org_id: str, change_id) -> dict:
    # Problems are staff-only under RLS, so requesters see the link without the problem's details.
    links = fetch_all(
        """
        SELECT l.id, l.record_type, l.record_id, l.relation, l.created_at,
               coalesce(i.number, p.number) AS record_number, coalesce(i.title, p.title) AS record_title,
               coalesce(i.state, p.state)::text AS record_state
        FROM public.change_links l
        LEFT JOIN public.incidents i ON l.record_type = 'incident' AND i.id = l.record_id
        LEFT JOIN public.problems p ON l.record_type = 'problem' AND p.id = l.record_id
        WHERE l.organization_id = %s AND l.change_id = %s ORDER BY l.created_at
        """,
        [org_id, str(change_id)],
    )
    affected = fetch_all(
        "SELECT ci.id, ci.name, ci.ci_class FROM public.changes c "
        "JOIN public.configuration_items ci ON ci.id = ANY(c.affected_ci_ids) "
        "WHERE c.organization_id = %s AND c.id = %s ORDER BY ci.name",
        [org_id, str(change_id)],
    )
    return {"links": links, "affected_cis": affected}


class ChangeLinksView(CallerAPIView):
    policy_actions = {"GET": "change.link.read", "POST": "change.link.manage"}

    def change_exists(self, change_id) -> None:
        if not fetch_one(
            "SELECT 1 AS ok FROM public.changes WHERE organization_id = %s AND id = %s", [self.org_id, str(change_id)]
        ):
            raise Http404

    def get(self, request, org_id, change_id):
        self.change_exists(change_id)
        return Response(change_links(self.org_id, change_id))

    def post(self, request, org_id, change_id):
        self.change_exists(change_id)
        data = LinkSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        table = RECORD_TABLES[v["recordType"]]
        if not fetch_one(
            f"SELECT 1 AS ok FROM public.{table} WHERE organization_id = %s AND id = %s",
            [self.org_id, str(v["recordId"])],
        ):
            return Response({"detail": f"That {v['recordType']} is not available in this workspace."}, status=400)
        execute(
            "INSERT INTO public.change_links(organization_id, change_id, record_type, record_id, relation, linked_by) "
            "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (change_id, record_type, record_id) DO NOTHING",
            [self.org_id, str(change_id), v["recordType"], str(v["recordId"]), v["relation"], request.user.user_id],
        )
        return Response(change_links(self.org_id, change_id), status=status.HTTP_201_CREATED)


class ChangeLinkDetailView(CallerAPIView):
    policy_actions = {"DELETE": "change.link.manage"}

    def delete(self, request, org_id, change_id, link_id):
        if not execute(
            "DELETE FROM public.change_links WHERE organization_id = %s AND change_id = %s AND id = %s",
            [self.org_id, str(change_id), str(link_id)],
        ):
            raise Http404
        return Response(change_links(self.org_id, change_id))


class LinkCandidatesView(CallerAPIView):
    """Recent incidents and problems a change can be linked to."""

    policy_actions = {"GET": "change.link.manage"}

    def get(self, request, org_id):
        org = [self.org_id]
        return Response(
            {
                "incidents": fetch_all(
                    "SELECT id, number, title, state::text AS state FROM public.incidents WHERE organization_id = %s "
                    "ORDER BY created_at DESC LIMIT 200",
                    org,
                ),
                "problems": fetch_all(
                    "SELECT id, number, title, state::text AS state FROM public.problems WHERE organization_id = %s "
                    "ORDER BY created_at DESC LIMIT 200",
                    org,
                ),
            }
        )


class IncidentLinksView(CallerAPIView):
    """Changes linked to an incident, and its problem (legacy getIncidentLinks)."""

    policy_actions = {"GET": "change.link.read"}

    def get(self, request, org_id, incident_id):
        incident = fetch_one(
            "SELECT problem_id FROM public.incidents WHERE organization_id = %s AND id = %s",
            [self.org_id, str(incident_id)],
        )
        if not incident:
            raise Http404
        changes = fetch_all(
            "SELECT l.id AS link_id, l.relation, c.id, c.number, c.title, c.state::text AS state, c.risk "
            "FROM public.change_links l JOIN public.changes c ON c.id = l.change_id "
            "WHERE l.organization_id = %s AND l.record_type = 'incident' AND l.record_id = %s ORDER BY l.created_at",
            [self.org_id, str(incident_id)],
        )
        problem = (
            fetch_one(
                "SELECT id, number, title, state::text AS state FROM public.problems WHERE id = %s",
                [incident["problem_id"]],
            )
            if incident["problem_id"]
            else None
        )
        return Response({"changes": changes, "problem": problem})
