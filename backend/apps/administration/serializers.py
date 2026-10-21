"""Ports of src/lib/admin-contract.ts. The itsm_admin_* functions re-check every rule."""

from rest_framework import serializers

ADMIN_ROLES = [
    "requester",
    "service_desk",
    "fulfiller",
    "change_manager",
    "cab_member",
    "cmdb_manager",
    "manager",
    "admin",
]


class RolesField(serializers.ListField):
    child = serializers.ChoiceField(choices=ADMIN_ROLES)

    def __init__(self, **kwargs):
        super().__init__(min_length=1, max_length=8, **kwargs)

    def to_internal_value(self, data):
        roles = super().to_internal_value(data)
        if len(set(roles)) != len(roles):
            raise serializers.ValidationError("Choose each role only once.")
        return roles


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    roles = RolesField()

    def validate_email(self, value):
        return value.strip().lower()


class UpdateMemberSerializer(serializers.Serializer):
    roles = RolesField()
    isActive = serializers.BooleanField()
    expectedVersion = serializers.IntegerField(min_value=1)


class RevokeInvitationSerializer(serializers.Serializer):
    expectedVersion = serializers.IntegerField(min_value=1)


class SaveGroupSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120)
    description = serializers.CharField(max_length=1000, allow_blank=True, default="")
    isActive = serializers.BooleanField(default=True)
    memberIds = serializers.ListField(child=serializers.UUIDField(), max_length=500, default=list)
    # Required when editing an existing group; omitted when creating one.
    expectedVersion = serializers.IntegerField(min_value=1, required=False)

    def validate_memberIds(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Choose each member only once.")
        return [str(v) for v in value]


class UpdateWorkspaceSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120)
    timezone = serializers.CharField(min_length=1, max_length=100)
    expectedVersion = serializers.IntegerField(min_value=1)
