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
