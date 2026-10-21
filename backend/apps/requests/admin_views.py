"""Catalogue administration (legacy updateCatalogRouting) and request fulfilment tasks
(legacy request-tasks.functions.ts)."""

from django.http import Http404
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import execute, fetch_all, fetch_one
from apps.core.views import CallerAPIView
from apps.security.serializers import OffsetDateTimeField

TASK_STATES = ["open", "in_progress", "closed", "cancelled"]
CATALOG_ADMIN_COLUMNS = """
  c.id, c.name, c.category, c.description, c.delivery_days, c.approval_required, c.active,
  c.default_priority, c.default_group_id, g.name AS group_name, c.updated_at
"""


class CatalogItemUpdateSerializer(serializers.Serializer):
    expectedUpdatedAt = serializers.DateTimeField()
    groupId = serializers.UUIDField(required=False, allow_null=True)
    priority = serializers.IntegerField(min_value=1, max_value=4, required=False)
    approvalRequired = serializers.BooleanField(required=False)
    active = serializers.BooleanField(required=False)


class TaskInputSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=3, max_length=160)
    # Picked in local time and converted in the browser; the server never applies its own timezone.
    dueAt = OffsetDateTimeField(required=False)


class TaskUpdateSerializer(serializers.Serializer):
    state = serializers.ChoiceField(choices=TASK_STATES)
    expectedUpdatedAt = serializers.DateTimeField()


def load_catalog_item(org_id: str, item_id) -> dict:
    row = fetch_one(
        f"SELECT {CATALOG_ADMIN_COLUMNS} FROM public.catalog_items c "
        "LEFT JOIN public.groups g ON g.id = c.default_group_id WHERE c.organization_id = %s AND c.id = %s",
        [org_id, str(item_id)],
    )
    if not row:
        raise Http404
    return row


class CatalogAdminListView(CallerAPIView):
    """Every catalogue item, including inactive ones, with its routing."""

    policy_actions = {"GET": "catalog.manage"}

    def get(self, request, org_id):
        rows = fetch_all(
            f"SELECT {CATALOG_ADMIN_COLUMNS} FROM public.catalog_items c "
            "LEFT JOIN public.groups g ON g.id = c.default_group_id "
            "WHERE c.organization_id = %s ORDER BY c.category, c.name",
            [self.org_id],
        )
        return Response({"results": rows})


class CatalogItemAdminView(CallerAPIView):
    policy_actions = {"PATCH": "catalog.manage"}

    def patch(self, request, org_id, item_id):
        data = CatalogItemUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        load_catalog_item(self.org_id, item_id)
        sets, params = [], []
        if "groupId" in v:
            group = str(v["groupId"]) if v["groupId"] else None
            if group and not fetch_one(
                "SELECT 1 AS ok FROM public.groups WHERE organization_id = %s AND id = %s AND is_active",
                [self.org_id, group],
            ):
                return Response({"detail": "That group is not available in this workspace."}, status=400)
            sets.append("default_group_id = %s")
            params.append(group)
        for key, column in (
            ("priority", "default_priority"),
            ("approvalRequired", "approval_required"),
            ("active", "active"),
        ):
            if key in v:
                sets.append(f"{column} = %s")
                params.append(v[key])
        if sets and not execute(
            f"UPDATE public.catalog_items SET {', '.join(sets)} "
            "WHERE organization_id = %s AND id = %s AND updated_at = %s",
            [*params, self.org_id, str(item_id), v["expectedUpdatedAt"]],
        ):
            return Response(
                {"detail": "This catalogue item changed after you opened it. Refresh and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(load_catalog_item(self.org_id, item_id))


def tasks_for(org_id: str, request_id) -> list[dict]:
    return fetch_all(
        "SELECT t.id, t.title, t.state::text AS state, t.due_at, t.assignee_id, p.display_name AS assignee_name, "
        "t.created_at, t.updated_at FROM public.request_tasks t "
        "LEFT JOIN public.profiles p ON p.id = t.assignee_id "
        "WHERE t.organization_id = %s AND t.request_id = %s ORDER BY t.created_at",
        [org_id, str(request_id)],
    )


class RequestTasksView(CallerAPIView):
    policy_actions = {"GET": "request.task.read", "POST": "request.task.manage"}

    def request_row(self, request_id) -> dict:
        row = fetch_one(
            "SELECT id, approval_status FROM public.service_requests WHERE organization_id = %s AND id = %s",
            [self.org_id, str(request_id)],
        )
        if not row:
            raise Http404
        return row

    def get(self, request, org_id, request_id):
        self.request_row(request_id)
        return Response({"results": tasks_for(self.org_id, request_id)})

    def post(self, request, org_id, request_id):
        parent = self.request_row(request_id)
        if parent["approval_status"] not in ("approved", "not_required"):
            return Response({"detail": "Fulfillment tasks can be added once the request is approved."}, status=400)
        data = TaskInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        execute(
            "INSERT INTO public.request_tasks(organization_id, request_id, title, state, assignee_id, due_at) "
            "VALUES (%s, %s, %s, 'open', %s, %s::timestamptz)",
            [self.org_id, str(request_id), v["title"].strip(), request.user.user_id, v.get("dueAt")],
        )
        return Response({"results": tasks_for(self.org_id, request_id)}, status=status.HTTP_201_CREATED)


class RequestTaskDetailView(CallerAPIView):
    policy_actions = {"PATCH": "request.task.manage"}

    def patch(self, request, org_id, request_id, task_id):
        data = TaskUpdateSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if not fetch_one(
            "SELECT 1 AS ok FROM public.request_tasks WHERE organization_id = %s AND request_id = %s AND id = %s",
            [self.org_id, str(request_id), str(task_id)],
        ):
            raise Http404
        if not execute(
            "UPDATE public.request_tasks SET state = %s::public.record_state "
            "WHERE organization_id = %s AND request_id = %s AND id = %s AND updated_at = %s",
            [v["state"], self.org_id, str(request_id), str(task_id), v["expectedUpdatedAt"]],
        ):
            return Response(
                {"detail": "This task changed after you opened it. Refresh and try again."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"results": tasks_for(self.org_id, request_id)})
