"""Request validation ported from src/lib/security-workflow.ts (zod). Field names stay camelCase so
the JSON passed to the legacy functions is byte-for-byte what the TanStack server functions sent."""

import re
from datetime import UTC, datetime, timedelta

from rest_framework import serializers

SEVERITIES = ["critical", "high", "medium", "low"]
OFFSET_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$", re.IGNORECASE)


class OffsetDateTimeField(serializers.CharField):
    """Accepts only timestamps with an explicit offset. The browser converts local window times
    (security-window helper); the server must never apply its own timezone."""

    default_error_messages = {"invalid": "Choose a valid window time with a timezone."}

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not OFFSET_DATETIME.match(value):
            self.fail("invalid")
        try:
            datetime.fromisoformat(value.replace("z", "Z").replace("Z", "+00:00"))
        except ValueError:
            self.fail("invalid")
        return value


def parse_offset(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("z", "Z").replace("Z", "+00:00"))


def plan_field():
    return serializers.CharField(min_length=5, max_length=6000, trim_whitespace=True)


class FindingInputSerializer(serializers.Serializer):
    title = serializers.CharField(min_length=5, max_length=160)
    description = serializers.CharField(max_length=6000, allow_blank=True, default="")
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)
    severity = serializers.ChoiceField(choices=SEVERITIES)
    serviceId = serializers.UUIDField(required=False, allow_null=True)


class SubmitSerializer(serializers.Serializer):
    impactAssessment = plan_field()
    fixPlan = plan_field()
    testPlan = plan_field()
    rollbackPlan = plan_field()
    rollbackTrigger = plan_field()


class ApproveSerializer(serializers.Serializer):
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class RejectSerializer(serializers.Serializer):
    notes = serializers.CharField(min_length=1, max_length=2000)


class ScheduleSerializer(serializers.Serializer):
    windowStart = OffsetDateTimeField()
    windowEnd = OffsetDateTimeField()

    def validate(self, attrs):
        if parse_offset(attrs["windowEnd"]) <= parse_offset(attrs["windowStart"]):
            raise serializers.ValidationError({"windowEnd": "The fix window must end after it starts."})
        return attrs


class DeliverSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=["successful", "partial", "failed"])
    validationResults = plan_field()
    reviewNotes = plan_field()
    rollbackUsed = serializers.BooleanField()


class LinkSerializer(serializers.Serializer):
    changeId = serializers.CharField(required=False, allow_blank=True)
    incidentId = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        for key in ("changeId", "incidentId"):
            value = attrs.get(key)
            if value:
                serializers.UUIDField().to_internal_value(value)
        return attrs


class EmptySerializer(serializers.Serializer):
    pass


TRANSITIONS: dict[str, type[serializers.Serializer]] = {
    "submit": SubmitSerializer,
    "approve": ApproveSerializer,
    "reject": RejectSerializer,
    "schedule": ScheduleSerializer,
    "start": EmptySerializer,
    "deliver": DeliverSerializer,
    "close": EmptySerializer,
    "cancel": EmptySerializer,
    "link": LinkSerializer,
}


def validate_transition(data) -> tuple[str, dict]:
    if not isinstance(data, dict) or data.get("action") not in TRANSITIONS:
        raise serializers.ValidationError({"action": f"Choose one of: {', '.join(TRANSITIONS)}."})
    action = data["action"]
    serializer = TRANSITIONS[action](data={k: v for k, v in data.items() if k != "action"})
    serializer.is_valid(raise_exception=True)
    payload = {k: (str(v) if k.endswith("Id") and v is not None else v) for k, v in serializer.validated_data.items()}
    return action, payload


class ExceptionRequestSerializer(serializers.Serializer):
    justification = serializers.CharField(min_length=10, max_length=4000)
    compensatingControls = serializers.CharField(min_length=10, max_length=4000)
    expiresAt = OffsetDateTimeField()

    def validate_expiresAt(self, value):
        expires = parse_offset(value)
        now = datetime.now(UTC)
        if not now < expires <= now + timedelta(days=366):
            raise serializers.ValidationError("Expiry must be within the next year.")
        return value


class ExceptionDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approved", "rejected"])
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["decision"] == "rejected" and not attrs["notes"].strip():
            raise serializers.ValidationError({"notes": "Decision notes are required when rejecting."})
        return attrs


class ScannerFindingSerializer(serializers.Serializer):
    scanner = serializers.CharField(min_length=1, max_length=80)
    reference = serializers.CharField(min_length=1, max_length=120)
    title = serializers.CharField(min_length=3, max_length=160)
    description = serializers.CharField(max_length=6000, required=False, allow_blank=True, trim_whitespace=False)
    severity = serializers.ChoiceField(choices=SEVERITIES)
    asset = serializers.CharField(max_length=200, required=False, allow_blank=True)
    serviceId = serializers.UUIDField(required=False)
    ownerId = serializers.UUIDField(required=False)
    affectedCiIds = serializers.ListField(child=serializers.UUIDField(), max_length=100, required=False)
    impactAssessment = serializers.CharField(max_length=6000, required=False, allow_blank=True)
    fixPlan = serializers.CharField(max_length=6000, required=False, allow_blank=True)
    testPlan = serializers.CharField(max_length=6000, required=False, allow_blank=True)
    rollbackPlan = serializers.CharField(max_length=6000, required=False, allow_blank=True)
    rollbackTrigger = serializers.CharField(max_length=6000, required=False, allow_blank=True)

    def to_json(self) -> dict:
        out = {}
        for key, value in self.validated_data.items():
            if key == "affectedCiIds":
                out[key] = [str(v) for v in value]
            elif key in {"serviceId", "ownerId"}:
                out[key] = str(value)
            else:
                out[key] = value
        return out


class ScannerPayloadSerializer(serializers.Serializer):
    findings = serializers.ListField(child=serializers.DictField(), min_length=1, max_length=100)
