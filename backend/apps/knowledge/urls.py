from django.urls import path

from . import views

urlpatterns = [
    path("orgs/<uuid:org_id>/knowledge", views.ArticleListView.as_view()),
    path("orgs/<uuid:org_id>/knowledge/<uuid:article_id>", views.ArticleDetailView.as_view()),
]
