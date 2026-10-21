"""Assets & CMDB (legacy /assets and saveConfigurationItem). Staff read configuration items through RLS;
only CMDB owners and admins write them (ci_manage policy, mirrored in policies/itsm/cmdb.rego)."""

import json

from django.http import Http404
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import execute, fetch_all, fetch_one, like_pattern
from apps.core.views import CallerAPIView

CI_STATUSES = ["operational", "degraded", "maintenance", "retired"]
CRITICALITIES = ["low", "medium", "high", "critical"]
RELATIONSHIP_TYPES = ["depends_on", "runs_on", "connects_to", "hosts", "backs_up"]

CI_COLUMNS = """
  c.id, c.name, c.ci_class, c.asset_tag, c.environment, c.status, c.criticality, c.location,
  host(c.ip_address) AS ip_address, c.service_id, s.name AS service_name, c.owner_id,
  p.display_name AS owner_name, c.last_discovered_at, c.created_at, c.updated_at
"""
CI_FROM = """
  FROM public.configuration_items c
  LEFT JOIN public.services s ON s.id = c.service_id
  LEFT JOIN public.profiles p ON p.id = c.owner_id
"""


def audit(org_id: str, actor_id: str, record_id, action: str, after: dict) -> None:
    # No RETURNING: the caller may write audit events without being able to read them back.
    execute(
        "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source, "
        "after_values) VALUES (%s, 'asset', %s, %s, %s, 'application', %s::jsonb)",
        [org_id, str(record_id), actor_id, action, json.dumps(after, default=str)],
    )


class AssetInputSerializer(serializers.Serializer):
    """Port of the saveConfigurationItem validator."""

    name = serializers.CharField(min_length=2, max_length=120)
    ciClass = serializers.CharField(min_length=2, max_length=80)
    environment = serializers.CharField(max_length=40, allow_blank=True, default="")
    status = serializers.ChoiceField(choices=CI_STATUSES)
    criticality = serializers.ChoiceField(choices=CRITICALITIES)
    location = serializers.CharField(max_length=120, allow_blank=True, default="")
    serviceId = serializers.UUIDField(required=False, allow_null=True)
    expectedUpdatedAt = serializers.DateTimeField(required=False)


class RelationshipSerializer(serializers.Serializer):
    childId = serializers.UUIDField()
    relationshipType = serializers.ChoiceField(choices=RELATIONSHIP_TYPES)


def service_in_org(org_id: str, service_id) -> bool:
    return bool(
        fetch_one(
            "SELECT 1 AS ok FROM public.services WHERE organization_id = %s AND id = %s", [org_id, str(service_id)]
        )
    )


def relationships_for(org_id: str, ci_id) -> list[dict]:
    return fetch_all(
        "SELECT r.id, r.relationship_type, r.parent_id, pa.name AS parent_name, r.child_id, ch.name AS child_name "
        "FROM public.ci_relationships r "
        "JOIN public.configuration_items pa ON pa.id = r.parent_id "
        "JOIN public.configuration_items ch ON ch.id = r.child_id "
        "WHERE r.organization_id = %s AND (r.parent_id = %s OR r.child_id = %s) ORDER BY r.created_at",
        [org_id, str(ci_id), str(ci_id)],
    )


def load_asset(org_id: str, ci_id) -> dict:
    row = fetch_one(f"SELECT {CI_COLUMNS} {CI_FROM} WHERE c.organization_id = %s AND c.id = %s", [org_id, str(ci_id)])
    if not row:
        raise Http404
    row["relationships"] = relationships_for(org_id, ci_id)
    return row


def asset_values(v: dict) -> list:
    return [
        v["name"].strip(),
        v["ciClass"].strip(),
        v["environment"].strip() or None,
        v["status"],
        v["criticality"],
        v["location"].strip() or None,
        str(v["serviceId"]) if v.get("serviceId") else None,
    ]


class ServicesView(CallerAPIView):
    """Business services, for routing and filters. Members may read them (services_read)."""

    policy_actions = {"GET": "service.read"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT id, name, code, status, criticality FROM public.services WHERE organization_id = %s ORDER BY name",
            [self.org_id],
        )
        return Response({"results": rows})


class AssetListView(CallerAPIView):
    policy_actions = {"GET": "asset.read", "POST": "asset.manage"}

    def get(self, request, org_id):
        clauses = ["c.organization_id = %s"]
        params: list = [self.org_id]
        status_filter = request.query_params.get("status")
        if status_filter:
            if status_filter not in CI_STATUSES:
                return Response({"detail": "Unknown status filter."}, status=400)
            clauses.append("c.status = %s")
            params.append(status_filter)
        query = (request.query_params.get("q") or "").strip()[:120]
        if query:
            clauses.append("(c.name ILIKE %s OR c.ci_class ILIKE %s OR coalesce(c.asset_tag, '') ILIKE %s)")
            params += [like_pattern(query)] * 3
        rows = fetch_all(
            f"SELECT {CI_COLUMNS}, (SELECT count(*) FROM public.ci_relationships r "
            "WHERE r.parent_id = c.id OR r.child_id = c.id) AS relationship_count "
            f"{CI_FROM} WHERE {' AND '.join(clauses)} ORDER BY c.name LIMIT 500",
            params,
        )
        return Response({"results": rows})

    def post(self, request, org_id):
        data = AssetInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if v.get("serviceId") and not service_in_org(self.org_id, v["serviceId"]):
            return Response({"detail": "That service is not available in this workspace."}, status=400)
        row = fetch_one(
            "INSERT INTO public.configuration_items(organization_id, name, ci_class, environment, status, "
            "criticality, location, service_id, owner_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            [self.org_id, *asset_values(v), request.user.user_id],
        )
        audit(self.org_id, request.user.user_id, row["id"], "created", {"name": v["name"].strip()})
        return Response(load_asset(self.org_id, row["id"]), status=status.HTTP_201_CREATED)


class AssetDetailView(CallerAPIView):
    policy_actions = {"GET": "asset.read", "PATCH": "asset.manage"}

    def get(self, request, org_id, asset_id):
        return Response(load_asset(self.org_id, asset_id))

    def patch(self, request, org_id, asset_id):
        data = AssetInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if "expectedUpdatedAt" not in v:
            return Response({"expectedUpdatedAt": ["This field is required."]}, status=400)
        if v.get("serviceId") and not service_in_org(self.org_id, v["serviceId"]):
            return Response({"detail": "That service is not available in this workspace."}, status=400)
        load_asset(self.org_id, asset_id)
        updated = execute(
            "UPDATE public.configuration_items SET name = %s, ci_class = %s, environment = %s, status = %s, "
            "criticality = %s, location = %s, service_id = %s "
            "WHERE organization_id = %s AND id = %s AND updated_at = %s",
            [*asset_values(v), self.org_id, str(asset_id), v["expectedUpdatedAt"]],
        )
        if not updated:
            return Response(
                {"detail": "This configuration item changed after you opened it. Refresh and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        audit(self.org_id, request.user.user_id, asset_id, "updated", {"name": v["name"].strip()})
        return Response(load_asset(self.org_id, asset_id))


class RelationshipsView(CallerAPIView):
    policy_actions = {"POST": "asset.manage"}

    def post(self, request, org_id, asset_id):
        data = RelationshipSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        child = str(data.validated_data["childId"])
        kind = data.validated_data["relationshipType"]
        if child == str(asset_id):
            return Response({"detail": "A configuration item cannot depend on itself."}, status=400)
        load_asset(self.org_id, asset_id)
        load_asset(self.org_id, child)
        execute(
            "INSERT INTO public.ci_relationships(organization_id, parent_id, child_id, relationship_type) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (parent_id, child_id, relationship_type) DO NOTHING",
            [self.org_id, str(asset_id), child, kind],
        )
        audit(self.org_id, request.user.user_id, asset_id, "relationship_added", {"child_id": child, "type": kind})
        return Response(load_asset(self.org_id, asset_id), status=status.HTTP_201_CREATED)


class RelationshipDetailView(CallerAPIView):
    policy_actions = {"DELETE": "asset.manage"}

    def delete(self, request, org_id, asset_id, relationship_id):
        removed = execute(
            "DELETE FROM public.ci_relationships WHERE organization_id = %s AND id = %s "
            "AND (parent_id = %s OR child_id = %s)",
            [self.org_id, str(relationship_id), str(asset_id), str(asset_id)],
        )
        if not removed:
            raise Http404
        audit(self.org_id, request.user.user_id, asset_id, "relationship_removed", {"id": str(relationship_id)})
        return Response(load_asset(self.org_id, asset_id))
