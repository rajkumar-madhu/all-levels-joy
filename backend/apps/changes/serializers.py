"""Ports of changeInputSchema and the updateChange validator (src/lib/approval-workflow.ts, itsm.functions.ts)."""

from rest_framework import serializers

from apps.security.serializers import OffsetDateTimeField, parse_offset

STATES = ["new", "open", "in_progress", "pending", "resolved", "closed", "cancelled"]


def plan_field():
    return serializers.CharField(min_length=5, max_length=6000)


class ChangeInputSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=5, max_length=160)
    description = plan_field()
    changeType = serializers.ChoiceField(choices=["standard", "normal", "emergency"])
    risk = serializers.ChoiceField(choices=["low", "medium", "high", "critical"])
    serviceId = serializers.UUIDField(required=False, allow_null=True)
    ownerId = serializers.UUIDField(required=False, allow_null=True)
    implementationPlan = plan_field()
    testPlan = plan_field()
    rollbackPlan = plan_field()
    businessJustification = plan_field()
    impactAssessment = plan_field()
    expectedOutageMinutes = serializers.IntegerField(min_value=0, max_value=10080)
    affectedCiIds = serializers.ListField(child=serializers.UUIDField(), max_length=100, default=list)
    validationPlan = plan_field()
    rollbackTrigger = plan_field()
    communicationPlan = plan_field()
    # Converted from local time in the browser; the server never applies its own timezone.
    startAt = OffsetDateTimeField()
    endAt = OffsetDateTimeField()

    def validate(self, attrs):
        if parse_offset(attrs["endAt"]) <= parse_offset(attrs["startAt"]):
            raise serializers.ValidationError({"endAt": "The change window must end after it starts."})
        return attrs

    def to_json(self) -> dict:
        out = dict(self.validated_data)
        for key in ("serviceId", "ownerId"):
            if out.get(key) is not None:
                out[key] = str(out[key])
        out["affectedCiIds"] = [str(v) for v in out["affectedCiIds"]]
        return out


class ChangeActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["start", "deliver", "close", "cancel"])
    pirNotes = serializers.CharField(max_length=6000, required=False, allow_blank=True)
    deliveryOutcome = serializers.ChoiceField(
        choices=["successful", "successful_with_issues", "failed", "rolled_back"], required=False
    )
    validationResults = serializers.CharField(max_length=6000, required=False, allow_blank=True)
    rollbackUsed = serializers.BooleanField(required=False)
