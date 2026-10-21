from django.urls import path

from . import views

admin = "orgs/<uuid:org_id>/administration"
urlpatterns = [
    path(admin, views.AdministrationView.as_view()),
    path(f"{admin}/invitations", views.InvitationsView.as_view()),
    path(f"{admin}/invitations/<uuid:invitation_id>/revoke", views.RevokeInvitationView.as_view()),
    path(f"{admin}/members/<uuid:user_id>", views.MemberView.as_view()),
    path(f"{admin}/groups", views.GroupsView.as_view()),
    path(f"{admin}/groups/<uuid:group_id>", views.GroupView.as_view()),
    path(f"{admin}/workspace", views.WorkspaceSettingsView.as_view()),
    path("invitations/<uuid:invitation_id>", views.InvitationView.as_view()),
    path("orgs/<uuid:org_id>/audit", views.AuditView.as_view()),
    path("orgs/<uuid:org_id>/audit/facets", views.AuditFacetsView.as_view()),
]
