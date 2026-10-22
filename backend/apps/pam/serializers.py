from rest_framework import serializers

TEMPLATES = ["ssh", "database", "windows", "api_key"]
ENVIRONMENTS = ["production", "dr", "uat", "development"]
RISKS = ["critical", "high", "medium", "low"]
BULK_ACTIONS = ["enable_rotation", "disable_rotation", "verify", "move"]
PRODUCTION_APPROVAL = "Production secrets always need an approver."


class SecretFieldsSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120)
    host = serializers.CharField(max_length=255)
    port = serializers.IntegerField(min_value=1, max_value=65535, default=22)
    username = serializers.CharField(max_length=128)
    template = serializers.ChoiceField(choices=TEMPLATES, default="ssh")
    environment = serializers.ChoiceField(choices=ENVIRONMENTS)
    folder = serializers.CharField(max_length=80, default="General")
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    ownerGroupId = serializers.UUIDField(required=False, allow_null=True)
    approvalRequired = serializers.BooleanField(default=True)
    maxCheckoutMinutes = serializers.IntegerField(min_value=15, max_value=1440, default=240)
    rotationEnabled = serializers.BooleanField(default=False)
    rotationIntervalDays = serializers.IntegerField(min_value=1, max_value=365, default=30)
    rotateAfterCheckout = serializers.BooleanField(default=False)
    verifyEnabled = serializers.BooleanField(default=False)


class SecretCreateSerializer(SecretFieldsSerializer):
    # The account's current password. It is encrypted before it reaches the database and never returned.
    password = serializers.CharField(min_length=1, max_length=512, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["environment"] == "production" and not attrs["approvalRequired"]:
            raise serializers.ValidationError({"approvalRequired": PRODUCTION_APPROVAL})
        return attrs


class SecretUpdateSerializer(SecretFieldsSerializer):
    expectedUpdatedAt = serializers.DateTimeField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            if name != "expectedUpdatedAt":
                field.required = False
                field.default = serializers.empty


class PasswordSerializer(serializers.Serializer):
    password = serializers.CharField(min_length=1, max_length=512, trim_whitespace=False)


class BulkSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=100)
    action = serializers.ChoiceField(choices=BULK_ACTIONS)
    folder = serializers.CharField(max_length=80, required=False)

    def validate(self, attrs):
        if attrs["action"] == "move" and not (attrs.get("folder") or "").strip():
            raise serializers.ValidationError({"folder": "Choose a folder to move the secrets to."})
        return attrs


class AccessRequestSerializer(serializers.Serializer):
    secretId = serializers.UUIDField()
    reason = serializers.CharField(min_length=10, max_length=1000)
    ticketReference = serializers.CharField(max_length=40, required=False, allow_blank=True, allow_null=True)
    durationMinutes = serializers.IntegerField(min_value=15, max_value=1440)


class DecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["decision"] == "reject" and not attrs["notes"].strip():
            raise serializers.ValidationError({"notes": "Say why the request is rejected."})
        return attrs
