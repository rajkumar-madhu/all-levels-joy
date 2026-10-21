from dataclasses import dataclass, field


@dataclass(frozen=True)
class Workspace:
    id: str
    name: str
    slug: str | None
    roles: tuple[str, ...]

    @property
    def is_staff(self) -> bool:
        return bool(STAFF_ROLES.intersection(self.roles))


# Mirrors public.can_manage(): every role except plain requester counts as workspace staff.
STAFF_ROLES = frozenset(
    {"service_desk", "fulfiller", "change_manager", "cab_member", "cmdb_manager", "manager", "admin"}
)


@dataclass
class Principal:
    """The signed-in caller. `user_id` is the legacy auth.users id that RLS sees as auth.uid()."""

    user_id: str
    issuer: str
    subject: str
    email: str | None
    email_verified: bool
    claims: dict = field(repr=False, default_factory=dict)
    workspaces: list[Workspace] = field(default_factory=list)

    # DRF checks these on request.user.
    is_authenticated = True

    def workspace(self, org_id: str) -> Workspace | None:
        return next((w for w in self.workspaces if w.id == str(org_id)), None)

    def roles_by_workspace(self) -> dict[str, list[str]]:
        return {w.id: list(w.roles) for w in self.workspaces}
