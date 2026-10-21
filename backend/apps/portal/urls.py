from django.urls import path, re_path

from . import views

urlpatterns = [
    path("portal", views.PortalView.as_view()),
    path("portal/tickets", views.PortalTicketView.as_view()),
    # /portal/incidents/<id>/replies and /portal/requests/<id>/replies
    re_path(
        r"^portal/(?P<record_type>incident|request)s/(?P<record_id>[0-9a-fA-F-]{36})/replies$",
        views.PortalReplyView.as_view(),
    ),
]
