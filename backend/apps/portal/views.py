"""Customer portal (legacy /portal). Signed-in requesters see only records they raised; the legacy
`portal_allowed()` rule (confirmed @<PORTAL_EMAIL_DOMAIN> account) gates every read and write, and the
portal_* functions enforce it again in the database.

Public knowledge is served to anonymous visitors as the `anon` role, which RLS limits to published articles
and active categories (0023_public_knowledge_read).
"""

from django.conf import settings
from django.http import Http404, JsonResponse
from django.views import View
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import act_as_anon, act_as_service, act_as_user, call_function, fetch_all, fetch_one
from apps.core.views import CallerAPIView

CATEGORIES = ["network", "hardware", "software", "database", "inquiry"]


class PortalAPIView(CallerAPIView):
    """Portal endpoints are not addressed by workspace; they file into PORTAL_ORG_ID."""

    @property
    def org_id(self) -> str:
        return settings.PORTAL_ORG_ID

    def policy_resource(self, request) -> dict:
        return {"org_id": settings.PORTAL_ORG_ID, "portal_domain": settings.PORTAL_EMAIL_DOMAIN}


class PortalView(PortalAPIView):
    policy_actions = {"GET": "portal.use"}

    def get(self, request):
        user_id = request.user.user_id
        if not call_function("portal_allowed"):
            return Response({"allowed": False})
        incidents = fetch_all(
            "SELECT id, number, title, description, state::text AS state, priority, sla_due_at, resolved_at, "
            "resolution_notes, created_at, updated_at, problem_id, on_hold_reason FROM public.incidents "
            "WHERE organization_id = %s AND requester_id = %s ORDER BY created_at DESC",
            [self.org_id, user_id],
        )
        requests_ = fetch_all(
            "SELECT id, number, title, description, state::text AS state, approval_status, due_at, created_at, "
            "updated_at, priority, awaiting_customer_since FROM public.service_requests "
            "WHERE organization_id = %s AND requester_id = %s ORDER BY created_at DESC",
            [self.org_id, user_id],
        )
        record_ids = [str(r["id"]) for r in incidents + requests_]
        incident_ids = [str(i["id"]) for i in incidents]
        problem_ids = sorted({str(i["problem_id"]) for i in incidents if i["problem_id"]})

        # Linked problems and customer-facing outage updates are staff-only tables. They are read with the
        # service role, but only for records the caller's own RLS reads above proved to be theirs.
        act_as_service()
        comments = fetch_all(
            "SELECT id, record_type, record_id, author_id, body, created_at FROM public.record_comments "
            "WHERE record_id = ANY(%s::uuid[]) AND NOT internal ORDER BY created_at",
            [record_ids],
        )
        problems = fetch_all(
            "SELECT id, number, title, state::text AS state, known_error, "
            "CASE WHEN known_error THEN workaround END AS workaround FROM public.problems WHERE id = ANY(%s::uuid[])",
            [problem_ids],
        )
        outage_updates = fetch_all(
            "SELECT u.id, m.incident_id, u.body, u.update_type, u.created_at FROM public.major_incident_updates u "
            "JOIN public.major_incidents m ON m.id = u.major_incident_id "
            "WHERE m.incident_id = ANY(%s::uuid[]) AND u.audience = 'customer' ORDER BY u.created_at",
            [incident_ids],
        )
        act_as_user(user_id)
        for comment in comments:
            comment["mine"] = str(comment.pop("author_id")) == user_id
        return Response(
            {
                "allowed": True,
                "incidents": incidents,
                "requests": requests_,
                "comments": comments,
                "problems": problems,
                "outageUpdates": outage_updates,
            }
        )


class TicketSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=5, max_length=160)
    description = serializers.CharField(min_length=5, max_length=6000)
    impact = serializers.IntegerField(min_value=1, max_value=3)
    urgency = serializers.IntegerField(min_value=1, max_value=3)
    category = serializers.ChoiceField(choices=CATEGORIES, allow_null=True, required=False, default=None)


class PortalTicketView(PortalAPIView):
    policy_actions = {"POST": "portal.use"}

    def post(self, request):
        data = TicketSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        result = call_function(
            "portal_submit_ticket",
            [
                ("_org_id", self.org_id, "uuid"),
                ("_title", v["title"], "text"),
                ("_description", v["description"], "text"),
                ("_impact", v["impact"], "smallint"),
                ("_urgency", v["urgency"], "smallint"),
                ("_category", v["category"], "text"),
            ],
        )
        return Response(result, status=status.HTTP_201_CREATED)


class ReplySerializer(serializers.Serializer):
    body = serializers.CharField(min_length=1, max_length=4000)


class PortalReplyView(PortalAPIView):
    """Replying can resume a ticket waiting on the caller or reopen a recently resolved one (portal_reply)."""

    policy_actions = {"POST": "portal.use"}
    functions = {"incident": ("portal_reply", "_incident_id"), "request": ("portal_reply_request", "_request_id")}

    def post(self, request, record_type, record_id):
        data = ReplySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        function, argument = self.functions[record_type]
        result = call_function(
            function, [(argument, str(record_id), "uuid"), ("_body", data.validated_data["body"], "text")]
        )
        return Response({"ok": True, "outcome": (result or {}).get("outcome", "comment")})


def _like_terms(query: str) -> list[str]:
    return [term for term in query.lower().split() if term]


class PublicKnowledgeView(View):
    """Anonymous knowledge search for the portal (legacy searchPublicKnowledge)."""

    http_method_names = ["get"]

    def get(self, request):
        query = (request.GET.get("query") or "").strip()[:120]
        category = (request.GET.get("category") or "").strip()[:60]
        act_as_anon()
        categories = fetch_all(
            "SELECT id, name, description, sort_order FROM public.knowledge_categories "
            "WHERE organization_id = %s AND active ORDER BY sort_order, name",
            [settings.PORTAL_ORG_ID],
        )
        articles = fetch_all(
            "SELECT id, number, title, summary, category, tags, published_at FROM public.knowledge_articles "
            "WHERE organization_id = %s AND status = 'published' ORDER BY published_at DESC NULLS LAST LIMIT 200",
            [settings.PORTAL_ORG_ID],
        )
        terms = _like_terms(query)

        def matches(article) -> bool:
            if category and article["category"] != category:
                return False
            haystack = " ".join(
                [article["title"] or "", article["summary"] or "", article["category"] or "", *(article["tags"] or [])]
            ).lower()
            return all(term in haystack for term in terms)

        return JsonResponse(
            {"categories": categories, "articles": [a for a in articles if matches(a)][:50]},
            headers={"Cache-Control": "public, max-age=60"},
        )


class PublicArticleView(View):
    http_method_names = ["get"]

    def get(self, request, article_id):
        act_as_anon()
        article = fetch_one(
            "SELECT id, number, title, summary, content, category, tags, published_at FROM public.knowledge_articles "
            "WHERE organization_id = %s AND id = %s AND status = 'published'",
            [settings.PORTAL_ORG_ID, str(article_id)],
        )
        if not article:
            raise Http404
        return JsonResponse(article)
