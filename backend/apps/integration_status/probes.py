"""Reachability of the platform services and the internal tool catalogue (legacy integration-status).

Only up/down/absent states leave this module; no URL credentials or secret values are ever read here.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import requests
from django.conf import settings

# Same catalogue as the legacy page. `probe` is an in-cluster health URL; `state` pins a known status.
INTERNAL_TOOLS: list[dict] = [
    {
        "name": "Prometheus",
        "kind": "Metrics",
        "url": "",
        "probe": "http://prometheus.wecrew-observatory.svc.cluster.local:9090/-/healthy",
    },
    {
        "name": "Grafana",
        "kind": "Dashboards",
        "url": "https://ops.wecrew.in",
        "probe": "http://wecrew-ops-grafana.wecrew-ops.svc.cluster.local/api/health",
    },
    {
        "name": "VictoriaMetrics",
        "kind": "Metrics",
        "url": "https://ops.wecrew.in",
        "probe": "http://victoria-metrics.wecrew-ops.svc.cluster.local:8428/health",
    },
    {
        "name": "Alertmanager",
        "kind": "Alerts",
        "url": "https://ops.wecrew.in",
        "probe": "http://wecrew-ops-alertmanager.wecrew-ops.svc.cluster.local:9093/-/ready",
    },
    {
        "name": "Tempo",
        "kind": "Traces",
        "url": "https://ops.wecrew.in",
        "probe": "http://wecrew-ops-tempo.wecrew-ops.svc.cluster.local:3100/ready",
    },
    {"name": "OpenSearch", "kind": "Logs", "url": "", "probe": "http://opensearch.wecrew-logs.svc.cluster.local:9200/"},
    {"name": "Zabbix", "kind": "Monitoring", "url": "", "state": "absent"},
    {"name": "Elasticsearch", "kind": "Logs", "url": "", "state": "absent"},
    {"name": "Logstash", "kind": "Logs", "url": "", "state": "absent"},
    {"name": "Kibana", "kind": "Logs", "url": "", "state": "absent"},
    {"name": "Jenkins", "kind": "CI", "url": "https://jenkins.wecrew.in"},
    {"name": "Gitea", "kind": "Source", "url": "https://gitea.wecrew.in"},
    {"name": "Harbor", "kind": "Registry", "url": "https://harbor.wecrew.in"},
    {"name": "n8n", "kind": "Automation", "url": "https://n8n-admin.wecrew.in"},
    {"name": "DevOps Nexus", "kind": "Platform", "url": "https://app.wecrew.in"},
    {"name": "Observatory", "kind": "Observability", "url": "https://observatory.wecrew.in"},
    {"name": "CronGuard", "kind": "Schedules", "url": "https://cronguard.wecrew.in"},
    {"name": "Alertmind", "kind": "Alerts", "url": "https://alertmind.wecrew.in"},
    {"name": "Infra assets", "kind": "CMDB", "url": "https://infraasset.wecrew.in"},
    {"name": "Ops", "kind": "Operations", "url": "https://ops.wecrew.in"},
    {"name": "Docs", "kind": "Docs", "url": "https://docs.wecrew.in"},
]
CACHE_SECONDS = 30
_cache: dict = {}
_lock = threading.Lock()


def probe(url: str) -> str:
    if not url:
        return "absent"
    try:
        response = requests.get(url, timeout=5, allow_redirects=False)
    except requests.RequestException:
        return "down"
    return "up" if 0 < response.status_code < 500 else "down"


def redis_state() -> str:
    try:
        import redis

        return "up" if redis.Redis.from_url(settings.CELERY_BROKER_URL, socket_timeout=3).ping() else "down"
    except Exception:  # noqa: BLE001 - any failure means the broker is unusable
        return "down"


def _platform_checks() -> list[tuple[dict, callable]]:
    issuer = settings.KEYCLOAK_ISSUER.rstrip("/")
    return [
        (
            {"name": "Keycloak", "kind": "Identity", "url": issuer},
            lambda: probe(f"{issuer}/.well-known/openid-configuration"),
        ),
        (
            {"name": "Policy service (OPA)", "kind": "Authorization", "url": ""},
            lambda: probe(f"{settings.OPA_URL.rstrip('/')}/health"),
        ),
        ({"name": "Redis (Celery broker)", "kind": "Queue", "url": ""}, redis_state),
    ]


def read_tools() -> list[dict]:
    checks = _platform_checks() + [
        (tool, (lambda t=tool: t["state"]) if "state" in tool else (lambda t=tool: probe(t.get("probe") or t["url"])))
        for tool in INTERNAL_TOOLS
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        states = list(pool.map(lambda check: check[1](), checks))
    return [
        {"name": tool["name"], "kind": tool["kind"], "url": tool["url"], "state": state}
        for (tool, _), state in zip(checks, states, strict=True)
    ]


def cached_tools(force: bool = False) -> tuple[str, list[dict]]:
    with _lock:
        if not force and _cache.get("expires", 0) > time.monotonic():
            return _cache["checked_at"], _cache["tools"]
    tools = read_tools()
    checked_at = datetime.now(UTC).isoformat()
    with _lock:
        _cache.update(expires=time.monotonic() + CACHE_SECONDS, checked_at=checked_at, tools=tools)
    return checked_at, tools
