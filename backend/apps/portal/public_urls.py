from django.urls import path

from . import views

# Anonymous: published knowledge only.
urlpatterns = [
    path("knowledge", views.PublicKnowledgeView.as_view()),
    path("knowledge/<uuid:article_id>", views.PublicArticleView.as_view()),
]
