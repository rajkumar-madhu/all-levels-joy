from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/approvals", views.MyApprovalsView.as_view()),
    path("orgs/<uuid:org_id>/approvals/<uuid:approval_id>/decision", views.DecideApprovalView.as_view()),
]
