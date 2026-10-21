import json

from django.http import Http404
from rest_framework import status
from rest_framework.response import Response

from apps.core.db import call_function, execute, fetch_all, fetch_one, like_pattern
from apps.core.exceptions import Conflict
from apps.core.views import CallerAPIView

from .serializers import ARTICLE_STATUSES, ArticleSerializer, CategorySerializer, slugify

COLUMNS = """
  k.id, k.number, k.title, k.summary, k.category, k.tags, k.status, k.version,
  k.published_at, k.expires_at, k.helpful_count, k.updated_at
"""
CONFLICT_MESSAGE = "This article changed after you opened it. Reload it and reapply your edits."


def audit(org_id: str, actor_id: str, record_id, action: str, after: dict) -> None:
    # No RETURNING: writing an audit event does not imply being able to read the log back.
    execute(
        "INSERT INTO public.audit_events(organization_id, record_type, record_id, actor_id, action, source, "
        "after_values) VALUES (%s, 'knowledge', %s, %s, %s, 'application', %s::jsonb)",
        [org_id, str(record_id), actor_id, action, json.dumps(after, default=str)],
    )


def load_article(org_id: str, article_id) -> dict:
    row = fetch_one(
        f"SELECT {COLUMNS}, k.content, k.author_id, a.display_name AS author_name FROM public.knowledge_articles k "
        "LEFT JOIN public.profiles a ON a.id = k.author_id WHERE k.organization_id = %s AND k.id = %s",
        [org_id, str(article_id)],
    )
    if not row:
        raise Http404
    return row


class ArticleListView(CallerAPIView):
    # RLS limits requesters to published articles; staff also see drafts, review and retired articles.
    policy_actions = {"GET": "knowledge.read", "POST": "knowledge.author"}

    def get(self, request, org_id):
        clauses = ["k.organization_id = %s"]
        params: list = [self.org_id]
        query = (request.query_params.get("q") or "").strip()[:120]
        if query:
            clauses.append("(k.title ILIKE %s OR k.summary ILIKE %s OR %s = ANY(k.tags))")
            like = like_pattern(query)
            params += [like, like, query.lower()]
        wanted = [s for s in (request.query_params.get("status") or "").split(",") if s in ARTICLE_STATUSES]
        if wanted:
            clauses.append("k.status = ANY(%s)")
            params.append(wanted)
        category = (request.query_params.get("category") or "").strip()[:60]
        if category:
            clauses.append("k.category = %s")
            params.append(category)
        rows = fetch_all(
            f"SELECT {COLUMNS} FROM public.knowledge_articles k WHERE {' AND '.join(clauses)} "
            "ORDER BY k.updated_at DESC LIMIT 200",
            params,
        )
        return Response({"results": rows})

    def post(self, request, org_id):
        data = ArticleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        number = call_function("next_record_number", [("_org_id", self.org_id, "uuid"), ("_prefix", "KB", "text")])
        article = fetch_one(
            "INSERT INTO public.knowledge_articles(organization_id, number, title, summary, content, category, tags, "
            "status, author_id, published_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, "
            "CASE WHEN %s = 'published' THEN now() END) RETURNING id, number",
            [
                self.org_id,
                number,
                v["title"].strip(),
                v["summary"].strip(),
                v["content"].strip(),
                v["category"].strip(),
                v["tags"],
                v["status"],
                request.user.user_id,
                v["status"],
            ],
        )
        audit(self.org_id, request.user.user_id, article["id"], "created", {"number": number, "status": v["status"]})
        return Response(load_article(self.org_id, article["id"]), status=status.HTTP_201_CREATED)


class ArticleDetailView(CallerAPIView):
    policy_actions = {"GET": "knowledge.read", "PATCH": "knowledge.author"}

    def get(self, request, org_id, article_id):
        return Response(load_article(self.org_id, article_id))

    def patch(self, request, org_id, article_id):
        data = ArticleSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        if "expectedUpdatedAt" not in v:
            return Response({"expectedUpdatedAt": ["Send the version of the article you edited."]}, status=400)
        current = fetch_one(
            "SELECT status, updated_at FROM public.knowledge_articles WHERE organization_id = %s AND id = %s",
            [self.org_id, str(article_id)],
        )
        if not current:
            raise Http404
        if current["updated_at"] != v["expectedUpdatedAt"]:
            raise Conflict(CONFLICT_MESSAGE)
        # Legacy behaviour: published_at is the time of the latest publish; leaving "published" clears it.
        # Each save of an already published article is a new version.
        if not execute(
            "UPDATE public.knowledge_articles SET title = %s, summary = %s, content = %s, category = %s, tags = %s, "
            "status = %s, published_at = CASE WHEN %s = 'published' THEN now() END, "
            "version = version + CASE WHEN status = 'published' THEN 1 ELSE 0 END "
            "WHERE organization_id = %s AND id = %s AND updated_at = %s",
            [
                v["title"].strip(),
                v["summary"].strip(),
                v["content"].strip(),
                v["category"].strip(),
                v["tags"],
                v["status"],
                v["status"],
                self.org_id,
                str(article_id),
                current["updated_at"],
            ],
        ):
            raise Conflict(CONFLICT_MESSAGE)
        audit(self.org_id, request.user.user_id, article_id, "updated", {"status": v["status"]})
        return Response(load_article(self.org_id, article_id))


class CategoryListView(CallerAPIView):
    policy_actions = {"GET": "knowledge.read", "POST": "knowledge.author"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT c.id, c.name, c.slug, c.description, c.active, c.sort_order, "
            "(SELECT count(*) FROM public.knowledge_articles k WHERE k.organization_id = c.organization_id "
            "AND k.category = c.name) AS article_count FROM public.knowledge_categories c "
            "WHERE c.organization_id = %s ORDER BY c.sort_order, c.name",
            [self.org_id],
        )
        return Response({"results": rows})

    def post(self, request, org_id):
        data = CategorySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        name = v["name"].strip()
        if fetch_one(
            "SELECT 1 AS ok FROM public.knowledge_categories WHERE organization_id = %s "
            "AND (lower(name) = lower(%s) OR slug = %s)",
            [self.org_id, name, slugify(name)],
        ):
            return Response({"detail": "That category already exists."}, status=400)
        row = fetch_one(
            "INSERT INTO public.knowledge_categories(organization_id, name, slug, description, active) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            [self.org_id, name, slugify(name), v["description"].strip() or None, v["active"]],
        )
        return Response(row, status=status.HTTP_201_CREATED)


class CategoryDetailView(CallerAPIView):
    policy_actions = {"PATCH": "knowledge.author"}

    def patch(self, request, org_id, category_id):
        data = CategorySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        old = fetch_one(
            "SELECT name FROM public.knowledge_categories WHERE organization_id = %s AND id = %s",
            [self.org_id, str(category_id)],
        )
        if not old:
            raise Http404
        name = v["name"].strip()
        if fetch_one(
            "SELECT 1 AS ok FROM public.knowledge_categories WHERE organization_id = %s AND id <> %s "
            "AND (lower(name) = lower(%s) OR slug = %s)",
            [self.org_id, str(category_id), name, slugify(name)],
        ):
            return Response({"detail": "That category already exists."}, status=400)
        execute(
            "UPDATE public.knowledge_categories SET name = %s, slug = %s, description = %s, active = %s "
            "WHERE organization_id = %s AND id = %s",
            [name, slugify(name), v["description"].strip() or None, v["active"], self.org_id, str(category_id)],
        )
        # Articles store the category by name, so a rename carries them along (as the legacy app did),
        # in the same transaction as the rename.
        if old["name"] != name:
            execute(
                "UPDATE public.knowledge_articles SET category = %s WHERE organization_id = %s AND category = %s",
                [name, self.org_id, old["name"]],
            )
        return Response({"ok": True})
