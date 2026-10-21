from rest_framework import serializers

STATES = ["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"]


class ServiceRequestInputSerializer(serializers.Serializer):
    """Port of serviceRequestInputSchema; itsm_create_service_request re-checks the limits."""

    catalogItemId = serializers.UUIDField()
    title = serializers.CharField(min_length=5, max_length=160)
    description = serializers.CharField(min_length=5, max_length=6000)


class ServiceRequestUpdateSerializer(serializers.Serializer):
    state = serializers.ChoiceField(choices=STATES)
    # The row's updated_at as last read; the update only applies if nobody changed it since.
    expectedUpdatedAt = serializers.DateTimeField()
    awaitingCustomer = serializers.BooleanField(required=False)
