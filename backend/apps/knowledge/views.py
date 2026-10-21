from django.http import Http404
from rest_framework.response import Response

from apps.core.db import fetch_all, fetch_one
from apps.core.views import CallerAPIView

COLUMNS = """
  k.id, k.number, k.title, k.summary, k.category, k.tags, k.status, k.version,
  k.published_at, k.expires_at, k.helpful_count, k.updated_at
"""


class ArticleListView(CallerAPIView):
    # RLS limits requesters to published articles; authors also see drafts.
    policy_actions = {"GET": "knowledge.read"}

    def get(self, request, org_id):
        clauses = ["k.organization_id = %s"]
        params: list = [self.org_id]
        query = (request.query_params.get("q") or "").strip()[:120]
        if query:
            clauses.append("(k.title ILIKE %s OR k.summary ILIKE %s OR %s = ANY(k.tags))")
            like = "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            params += [like, like, query.lower()]
        rows = fetch_all(
            f"SELECT {COLUMNS} FROM public.knowledge_articles k WHERE {' AND '.join(clauses)} "
            "ORDER BY k.updated_at DESC LIMIT 200",
            params,
        )
        return Response({"results": rows})


class ArticleDetailView(CallerAPIView):
    policy_actions = {"GET": "knowledge.read"}

    def get(self, request, org_id, article_id):
        row = fetch_one(
            f"SELECT {COLUMNS}, k.content FROM public.knowledge_articles k WHERE k.organization_id = %s AND k.id = %s",
            [self.org_id, str(article_id)],
        )
        if not row:
            raise Http404
        return Response(row)
