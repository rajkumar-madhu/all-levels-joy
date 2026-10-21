from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/problems", views.ProblemListView.as_view()),
    path("orgs/<uuid:org_id>/problems/<uuid:problem_id>", views.ProblemDetailView.as_view()),
    path("orgs/<uuid:org_id>/problems/<uuid:problem_id>/incidents", views.ProblemIncidentsView.as_view()),
]
