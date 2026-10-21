"""Ports of saveKnowledgeArticle (src/lib/itsm.functions.ts) and saveKnowledgeCategory
(src/lib/knowledge.functions.ts) validation."""

import re

from rest_framework import serializers

ARTICLE_STATUSES = ["draft", "review", "published", "retired"]


def normalize_tag(tag: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", tag.strip().lower()).strip("-")[:40]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


class ArticleSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=5, max_length=160)
    summary = serializers.CharField(max_length=400, allow_blank=True, default="")
    content = serializers.CharField(min_length=10, max_length=20000)
    category = serializers.CharField(min_length=2, max_length=60)
    status = serializers.ChoiceField(choices=ARTICLE_STATUSES)
    tags = serializers.ListField(
        child=serializers.CharField(max_length=40, allow_blank=True), max_length=12, default=list
    )
    # Required when editing; the save only applies to the version the author opened.
    expectedUpdatedAt = serializers.DateTimeField(required=False)

    def validate_tags(self, tags):
        seen: list[str] = []
        for tag in map(normalize_tag, tags):
            if tag and tag not in seen:
                seen.append(tag)
        return seen


class CategorySerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=60)
    description = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    active = serializers.BooleanField(default=True)

    def validate_name(self, name):
        if not slugify(name):
            raise serializers.ValidationError("Use letters or numbers in the category name.")
        return name
