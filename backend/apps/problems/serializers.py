"""Ports of createProblem / updateProblem / linkIncidentToProblem validators (src/lib/problem.functions.ts)."""

from rest_framework import serializers

STATES = ["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"]


def optional_text(max_length: int):
    return serializers.CharField(max_length=max_length, required=False, allow_blank=True, allow_null=True)


class ProblemCreateSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=5, max_length=160)
    description = serializers.CharField(min_length=5, max_length=6000)
    impact = serializers.IntegerField(min_value=1, max_value=3)
    urgency = serializers.IntegerField(min_value=1, max_value=3)
    category = optional_text(40)
    serviceId = serializers.UUIDField(required=False, allow_null=True)
    fromIncidentId = serializers.UUIDField(required=False, allow_null=True)
    assignToMe = serializers.BooleanField(default=False)


class ProblemUpdateSerializer(serializers.Serializer):
    expectedUpdatedAt = serializers.DateTimeField()
    state = serializers.ChoiceField(choices=STATES, required=False)
    assignToMe = serializers.BooleanField(required=False)
    knownError = serializers.BooleanField(required=False)
    workaround = optional_text(4000)
    rootCause = optional_text(4000)
    fixPlan = optional_text(4000)
    resolutionNotes = optional_text(4000)
    impact = serializers.IntegerField(min_value=1, max_value=3, required=False)
    urgency = serializers.IntegerField(min_value=1, max_value=3, required=False)
    knowledgeArticleId = serializers.UUIDField(required=False, allow_null=True)


class LinkSerializer(serializers.Serializer):
    incidentId = serializers.UUIDField()
    linked = serializers.BooleanField()
