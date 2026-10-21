"""Django settings for the ITSM API.

Everything environment-specific comes from environment variables so the same image runs in
local compose, staging and production. See `.env.example` for the full list.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def env_bool(name: str, default: bool = False) -> bool:
    value = env(name)
    return default if value is None else value.lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in (env(name, default) or "").split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG")
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-key" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY is required when DJANGO_DEBUG is off")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

# No django.contrib.auth/admin/sessions: identity lives in Keycloak and the legacy `auth.users`
# compatibility table, and Django never writes its own user tables into the shared schema.
INSTALLED_APPS = [
    "django.contrib.postgres",
    "corsheaders",
    "rest_framework",
    "apps.core",
    "apps.workspaces",
    "apps.incidents",
    "apps.knowledge",
    "apps.security",
    "apps.requests",
    "apps.changes",
    "apps.approvals",
    "apps.comments",
    "apps.major_incidents",
    "apps.assistant",
    "apps.portal",
    "apps.integration_status",
    "apps.integrations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "itsm"),
        "USER": env("POSTGRES_USER", "itsm_api"),
        "PASSWORD": env("POSTGRES_PASSWORD", ""),
        "HOST": env("POSTGRES_HOST", "localhost"),
        "PORT": env("POSTGRES_PORT", "5432"),
        # Every request runs in one transaction so `SET LOCAL ROLE` and the per-request user
        # claim (see apps.core.db) cannot leak into another request on a pooled connection.
        "ATOMIC_REQUESTS": True,
        "CONN_MAX_AGE": int(env("POSTGRES_CONN_MAX_AGE", "60") or 60),
    }
}

USE_TZ = True
TIME_ZONE = "UTC"
USE_I18N = False
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.core.authentication.KeycloakJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["apps.core.permissions.IsAuthenticatedPrincipal"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "UNAUTHENTICATED_USER": None,
    "DATETIME_FORMAT": "iso-8601",
}

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
CORS_ALLOW_HEADERS = ["authorization", "content-type"]

# Keycloak (OIDC). The issuer is the realm URL, e.g. https://sso.wecrew.in/realms/itsm
KEYCLOAK_ISSUER = env("KEYCLOAK_ISSUER", "http://localhost:8080/realms/itsm")
KEYCLOAK_JWKS_URL = env("KEYCLOAK_JWKS_URL", f"{KEYCLOAK_ISSUER}/protocol/openid-connect/certs")
KEYCLOAK_AUDIENCE = env("KEYCLOAK_AUDIENCE", "itsm-api")
# Customer portal sign-ups were limited to this email domain in the legacy `portal_allowed()`.
PORTAL_EMAIL_DOMAIN = env("PORTAL_EMAIL_DOMAIN", "wecrew.in")

# OPA sidecar. Requests are denied when OPA cannot be reached.
OPA_URL = env("OPA_URL", "http://localhost:8181")
OPA_DECISION_PATH = env("OPA_DECISION_PATH", "v1/data/itsm/authz/allow")
OPA_TIMEOUT_SECONDS = float(env("OPA_TIMEOUT_SECONDS", "2") or 2)

# Webhook and scheduled-job secrets (same names as the legacy app).
MONITORING_WEBHOOK_TOKEN = env("MONITORING_WEBHOOK_TOKEN")
PAGERDUTY_WEBHOOK_SECRET = env("PAGERDUTY_WEBHOOK_SECRET")
SECURITY_SCANNER_SECRET = env("SECURITY_SCANNER_SECRET")
SLACK_WEBHOOK_URL = env("SLACK_WEBHOOK_URL")
TEAMS_WEBHOOK_URL = env("TEAMS_WEBHOOK_URL")
# Workspace that webhook traffic is filed into (legacy DEMO_ORG_ID).
INTEGRATION_ORG_ID = env("INTEGRATION_ORG_ID", "10000000-0000-0000-0000-000000000001")
APP_PUBLIC_URL = env("APP_PUBLIC_URL", "http://localhost:5173")

# Support assistant (Anthropic API). Empty key = assistant reports "not configured".
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = env("ANTHROPIC_MODEL", "claude-opus-5-5")
ASSISTANT_MAX_TOKENS = int(env("ASSISTANT_MAX_TOKENS", "16000") or 16000)

# Customer portal: the workspace portal tickets are filed into (legacy DEMO_ORG_ID).
PORTAL_ORG_ID = env("PORTAL_ORG_ID", "10000000-0000-0000-0000-000000000001")

# Legacy schema sources applied by `manage.py apply_legacy_schema`.
LEGACY_SQL_ROOT = Path(env("LEGACY_SQL_ROOT", str(BASE_DIR.parent)) or BASE_DIR.parent)

CELERY_BROKER_URL = env("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = None
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER")
CELERY_BEAT_SCHEDULE = {
    "expire-security-exceptions": {
        "task": "apps.integrations.tasks.expire_security_exceptions",
        "schedule": 15 * 60,
    },
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
DATA_UPLOAD_MAX_MEMORY_SIZE = 512_000
