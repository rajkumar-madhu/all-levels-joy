from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/integrations/status", views.IntegrationStatusView.as_view()),
    path("orgs/<uuid:org_id>/integrations/test", views.IntegrationTestView.as_view()),
]
