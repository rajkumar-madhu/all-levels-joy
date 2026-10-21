from rest_framework import serializers


class SelfServiceIncidentSerializer(serializers.Serializer):
    """Same limits as public.itsm_self_service_incident; the function re-checks all of them."""

    title = serializers.CharField(min_length=5, max_length=160, trim_whitespace=True)
    description = serializers.CharField(min_length=5, max_length=6000, trim_whitespace=True)
    impact = serializers.IntegerField(min_value=1, max_value=3)
    urgency = serializers.IntegerField(min_value=1, max_value=3)
    category = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    subcategory = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    contactType = serializers.ChoiceField(choices=["self_service", "chat"], default="self_service")


class IncidentUpdateSerializer(serializers.Serializer):
    """Port of incidentUpdateSchema. Only fields the caller sends are applied."""

    expectedUpdatedAt = serializers.DateTimeField()
    state = serializers.ChoiceField(
        choices=["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"], required=False
    )
    assignToMe = serializers.BooleanField(required=False)
    groupId = serializers.UUIDField(required=False, allow_null=True)
    impact = serializers.IntegerField(min_value=1, max_value=3, required=False)
    urgency = serializers.IntegerField(min_value=1, max_value=3, required=False)
    resolutionNotes = serializers.CharField(max_length=4000, required=False, allow_blank=True)
    category = serializers.CharField(max_length=40, required=False, allow_blank=True, allow_null=True)
    subcategory = serializers.CharField(max_length=60, required=False, allow_blank=True, allow_null=True)
    onHoldReason = serializers.CharField(max_length=40, required=False, allow_blank=True, allow_null=True)
    closeCode = serializers.CharField(max_length=40, required=False, allow_blank=True, allow_null=True)
