from django.urls import path

from . import views

prefix = "orgs/<uuid:org_id>/assistant"
urlpatterns = [
    path(f"{prefix}/threads", views.ThreadListView.as_view()),
    path(f"{prefix}/threads/<uuid:thread_id>", views.ThreadDetailView.as_view()),
    path(f"{prefix}/threads/<uuid:thread_id>/messages", views.MessageView.as_view()),
    path(f"{prefix}/messages/<uuid:message_id>/ticket", views.TicketFromMessageView.as_view()),
]
