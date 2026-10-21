from django.urls import path

from . import views

urlpatterns = [
    path("alerts", views.AlertsView.as_view()),
    path("pagerduty", views.PagerDutyView.as_view()),
    path("security-findings", views.SecurityFindingsView.as_view()),
]
