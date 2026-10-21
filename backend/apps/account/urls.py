from django.urls import path

from . import views

urlpatterns = [
    path("me/profile", views.ProfileView.as_view()),
    path("orgs/<uuid:org_id>/notifications", views.NotificationsView.as_view()),
    path("orgs/<uuid:org_id>/notifications/read-all", views.MarkNotificationsReadView.as_view()),
]
