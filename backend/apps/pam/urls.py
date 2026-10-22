from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/pam/secrets", views.PamSecretListView.as_view()),
    path("orgs/<uuid:org_id>/pam/secrets/bulk", views.PamBulkView.as_view()),
    path("orgs/<uuid:org_id>/pam/secrets/<uuid:secret_id>", views.PamSecretDetailView.as_view()),
    path("orgs/<uuid:org_id>/pam/secrets/<uuid:secret_id>/password", views.PamSecretPasswordView.as_view()),
    path(
        "orgs/<uuid:org_id>/pam/secrets/<uuid:secret_id>/rotate",
        views.PamSecretActionView.as_view(operation="rotate"),
    ),
    path(
        "orgs/<uuid:org_id>/pam/secrets/<uuid:secret_id>/verify",
        views.PamSecretActionView.as_view(operation="verify"),
    ),
    path("orgs/<uuid:org_id>/pam/requests", views.PamRequestListView.as_view()),
    path("orgs/<uuid:org_id>/pam/requests/<uuid:request_id>/decision", views.PamRequestDecisionView.as_view()),
    path("orgs/<uuid:org_id>/pam/requests/<uuid:request_id>/reveal", views.PamRequestRevealView.as_view()),
    path("orgs/<uuid:org_id>/pam/requests/<uuid:request_id>/check-in", views.PamRequestCheckInView.as_view()),
    path("orgs/<uuid:org_id>/pam/requests/<uuid:request_id>/cancel", views.PamRequestCancelView.as_view()),
]
