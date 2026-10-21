"""Normalise Prometheus Alertmanager, Grafana and generic webhook payloads into one alert shape.

Port of src/lib/monitoring-alerts.ts. The `[alert:source:fingerprint]` marker format must not change:
open monitoring incidents created by either stack are deduplicated by it.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_ALERTS_PER_REQUEST = 25
MAX_NEW_INCIDENTS_PER_WINDOW = 20
RATE_WINDOW_SECONDS = 10 * 60
MIN_TOKEN_LENGTH = 32

SOURCE_LABELS = {
    "prometheus": "Prometheus Alertmanager",
    "grafana": "Grafana",
    "webhook": "Generic webhook",
}


@dataclass(frozen=True)
class NormalizedAlert:
    source: str
    fingerprint: str
    name: str
    status: str
    severity: str
    instance: str | None
    service: str | None
    summary: str
    link: str | None
    starts_at: str | None


def safe_instance(value) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    v = value.strip()[:300]
    return v if re.fullmatch(r"[A-Za-z0-9.:-]+", v) else None


def safe_link(value) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parts = urlsplit(value)
    except ValueError:
        return None
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return None
    return value[:2000]


def slug(value: str) -> str:
    s = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")[:200]
    return s or "alert"


def _labels(value) -> dict[str, str] | None:
    if value is None:
        return {}
    if not isinstance(value, dict):
        return None
    if not all(isinstance(k, str) and isinstance(v, str) and len(v) <= 500 for k, v in value.items()):
        return None
    return value


def _optional_str(obj: dict, key: str, max_len: int = 2000) -> str | None | bool:
    """Returns the value, None when absent, or False when present but invalid."""
    if key not in obj or obj[key] is None:
        return None
    value = obj[key]
    return value if isinstance(value, str) and len(value) <= max_len else False


def _parse_alertmanager(payload: dict) -> list[NormalizedAlert] | None:
    alerts = payload.get("alerts")
    if not isinstance(alerts, list) or not 1 <= len(alerts) <= MAX_ALERTS_PER_REQUEST:
        return None
    title = _optional_str(payload, "title")
    if title is False or payload.get("status") not in (None, "firing", "resolved"):
        return None
    parsed = []
    for alert in alerts:
        if not isinstance(alert, dict) or alert.get("status") not in ("firing", "resolved"):
            return None
        labels, annotations = _labels(alert.get("labels")), _labels(alert.get("annotations"))
        if labels is None or annotations is None:
            return None
        fields = {
            k: _optional_str(alert, k)
            for k in ("startsAt", "generatorURL", "fingerprint", "dashboardURL", "panelURL", "silenceURL")
        }
        if any(v is False for v in fields.values()):
            return None
        parsed.append((alert["status"], labels, annotations, fields))

    is_grafana = "orgId" in payload or any(f["dashboardURL"] or f["panelURL"] for *_, f in parsed)
    source = "grafana" if is_grafana else "prometheus"
    result = []
    for status, labels, annotations, f in parsed:
        name = labels.get("alertname") or labels.get("rulename") or title or "Unnamed alert"
        instance = safe_instance(labels.get("instance") or labels.get("host"))
        result.append(
            NormalizedAlert(
                source=source,
                fingerprint=slug(f["fingerprint"] or f"{name}|{instance or ''}|{labels.get('job', '')}"),
                name=name[:200],
                status=status,
                severity=(labels.get("severity") or "warning").lower(),
                instance=instance,
                service=labels.get("service") or labels.get("job") or None,
                summary=(annotations.get("summary") or annotations.get("description") or "")[:4000],
                link=safe_link(f["dashboardURL"] or f["panelURL"] or f["generatorURL"]),
                starts_at=f["startsAt"],
            )
        )
    return result


def _parse_generic(payload: dict) -> list[NormalizedAlert] | None:
    name = payload.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 200:
        return None
    name = name.strip()
    status = payload.get("status", "firing")
    severity = payload.get("severity", "warning")
    summary = payload.get("summary", "")
    if status not in ("firing", "resolved") or not isinstance(severity, str) or len(severity) > 40:
        return None
    if not isinstance(summary, str) or len(summary) > 4000:
        return None
    limits = {"fingerprint": 200, "instance": 300, "service": 200, "link": 2000}
    opt = {k: _optional_str(payload, k, n) for k, n in limits.items()}
    if any(v is False for v in opt.values()):
        return None
    fingerprint = opt["fingerprint"].strip() if opt["fingerprint"] else None
    return [
        NormalizedAlert(
            source="webhook",
            fingerprint=slug(fingerprint or f"{name}|{opt['instance'] or ''}"),
            name=name,
            status=status,
            severity=severity.lower(),
            instance=safe_instance(opt["instance"]),
            service=opt["service"],
            summary=summary,
            link=safe_link(opt["link"]),
            starts_at=None,
        )
    ]


def parse_alert_payload(payload) -> list[NormalizedAlert] | None:
    if not isinstance(payload, dict):
        return None
    return _parse_alertmanager(payload) or _parse_generic(payload)


def severity_to_impact(severity: str) -> tuple[int, int]:
    """(impact, urgency), 1 = highest. critical/page -> P1."""
    if severity in {"critical", "page", "p1", "disaster"}:
        return 1, 1
    if severity in {"error", "high", "major", "p2"}:
        return 1, 2
    if severity in {"warning", "warn", "medium", "p3"}:
        return 2, 2
    return 3, 3


def alert_marker(alert: NormalizedAlert) -> str:
    return f"[alert:{alert.source}:{alert.fingerprint}]"
