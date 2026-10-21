from django.urls import include, path

from apps.core import views as core_views

urlpatterns = [
    path("health", core_views.health),
    path("api/v1/", include("apps.workspaces.urls")),
    path("api/v1/", include("apps.incidents.urls")),
    path("api/v1/", include("apps.knowledge.urls")),
    path("api/v1/", include("apps.security.urls")),
    # Public intake keeps the legacy paths so senders only change the host.
    path("api/public/", include("apps.integrations.urls")),
]
