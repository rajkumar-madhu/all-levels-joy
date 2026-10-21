"""Ports of the declare/update/post validators in src/lib/problem.functions.ts."""

from urllib.parse import urlsplit

from rest_framework import serializers

BRIDGE_STATES = ["declared", "investigating", "mitigating", "monitoring", "resolved"]


class BridgeUrlField(serializers.CharField):
    """Shown as a link, so only http(s) is accepted (the legacy app stored any text)."""

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if value:
            parts = urlsplit(value)
            if parts.scheme not in ("http", "https") or not parts.netloc:
                raise serializers.ValidationError("Use an http(s) link for the bridge.")
        return value


class DeclareSerializer(serializers.Serializer):
    incidentId = serializers.UUIDField()
    severity = serializers.IntegerField(min_value=1, max_value=3)
    situationSummary = serializers.CharField(min_length=10, max_length=4000)
    customerImpact = serializers.CharField(max_length=2000, required=False, allow_blank=True, allow_null=True)
    bridgeUrl = BridgeUrlField(max_length=500, required=False, allow_blank=True, allow_null=True)
    takeCommand = serializers.BooleanField(default=True)
    nextUpdateMinutes = serializers.IntegerField(min_value=5, max_value=480, default=30)


class UpdateSerializer(serializers.Serializer):
    bridgeState = serializers.ChoiceField(choices=BRIDGE_STATES, required=False)
    escalationLevel = serializers.IntegerField(min_value=1, max_value=4, required=False)
    severity = serializers.IntegerField(min_value=1, max_value=3, required=False)
    situationSummary = serializers.CharField(max_length=4000, required=False, allow_blank=True, allow_null=True)
    customerImpact = serializers.CharField(max_length=2000, required=False, allow_blank=True, allow_null=True)
    bridgeUrl = BridgeUrlField(max_length=500, required=False, allow_blank=True, allow_null=True)
    takeCommand = serializers.BooleanField(required=False)
    takeComms = serializers.BooleanField(required=False)
    nextUpdateMinutes = serializers.IntegerField(min_value=5, max_value=480, required=False)
    problemId = serializers.UUIDField(required=False, allow_null=True)


class PostUpdateSerializer(serializers.Serializer):
    body = serializers.CharField(min_length=3, max_length=4000)
    updateType = serializers.ChoiceField(
        choices=["status", "action", "escalation", "comms", "resolution"], default="status"
    )
    audience = serializers.ChoiceField(choices=["internal", "customer", "executive"], default="internal")
    nextUpdateMinutes = serializers.IntegerField(min_value=5, max_value=480, required=False)
