"""Builds the assistant's system prompt from the caller's own view of knowledge and the catalogue.

Port of the ranking in the legacy sendChatMessage. Reads run as the caller, so RLS decides which
articles and catalogue items can ground an answer.
"""

import re

from apps.core.db import fetch_all

CATEGORIES = {"network", "hardware", "software", "database", "inquiry"}


def rank_articles(question: str, articles: list[dict], limit: int = 6) -> list[dict]:
    terms = [t for t in re.split(r"[^a-z0-9]+", question.lower()) if len(t) > 2]
    scored = []
    for article in articles:
        title = (article["title"] or "").lower()
        category = (article["category"] or "").lower()
        tags = [t.lower() for t in article.get("tags") or []]
        body = f"{article.get('summary') or ''} {article.get('content') or ''}".lower()
        score = sum(
            (3 if term in title else 0)
            + (4 if any(tag == term or term in tag.split("-") for tag in tags) else 0)
            + (2 if term in category else 0)
            + (1 if term in body else 0)
            for term in terms
        )
        if score > 0:
            scored.append((score, article))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [article for _, article in scored[:limit]]


def link_citations(text: str, articles: list[dict]) -> str:
    """Turn bare article numbers into links, leaving numbers already inside a markdown link alone."""
    for article in articles:
        pattern = rf"(?<![\[/=])\b{re.escape(article['number'])}\b(?!\]\()"
        text = re.sub(pattern, f"[{article['number']}](/knowledge/{article['id']})", text)
    return text


def build_context(org_id: str, question: str) -> tuple[str, list[dict]]:
    articles = fetch_all(
        "SELECT id, number, title, summary, content, category, tags FROM public.knowledge_articles "
        "WHERE organization_id = %s AND status = 'published' ORDER BY updated_at DESC LIMIT 300",
        [org_id],
    )
    ranked = rank_articles(question, articles)
    for article in ranked:
        article["id"] = str(article["id"])
    knowledge = "\n\n---\n\n".join(
        f"{a['number']} — {a['title']}\nCategory: {a['category'] or 'none'}\n"
        f"Tags: {', '.join(a.get('tags') or []) or 'none'}\nLink: [{a['number']}](/knowledge/{a['id']})\n"
        f"{a.get('summary') or ''}\n{(a.get('content') or '')[:2500]}"
        for a in ranked
    )
    catalog = fetch_all(
        "SELECT name, category, description FROM public.catalog_items WHERE organization_id = %s AND active "
        "ORDER BY category, name LIMIT 60",
        [org_id],
    )
    catalog_text = "\n".join(
        f"- {c['name']} [{c['category'] or 'general'}]: {c['description'] or ''} → [Request {c['name']}](/catalog)"
        for c in catalog
    )
    system = "\n\n".join(
        [
            "You are the Argus IT service desk assistant for an internal ITSM workspace.",
            "Help employees troubleshoot common IT issues (VPN, Wi-Fi, email, printing, laptops, passwords, access "
            "requests, SaaS apps) with short, practical, numbered steps.",
            "Answer from the staff-written knowledge base articles below first. Follow their steps faithfully, cite "
            "each article you used with its markdown link exactly as given, and do not invent policies that "
            "contradict them. If no article covers the issue, say plainly that there is no knowledge article for it "
            "yet, give brief general guidance, and offer to raise a ticket.",
            "Write your reply to the employee first. Then, only if a ticket is warranted, call propose_ticket. "
            "Never claim a ticket was created; the employee must confirm it. If a simple step resolves the issue, "
            "do not propose a ticket.",
            "When the employee needs something new (access, software, hardware, accounts) rather than a fix, point "
            "them to the matching service catalogue item using its markdown link instead of proposing an incident.",
            "Keep replies under 200 words and use markdown (paragraphs, lists, bold, inline code, links).",
            f"Service catalogue:\n{catalog_text}" if catalog_text else "Service catalogue: (empty)",
            f"Knowledge base:\n{knowledge}" if knowledge else "Knowledge base: (none published yet)",
        ]
    )
    return system, ranked


def clean_proposal(raw, fallback_text: str) -> dict | None:
    """Validate the model's tool input before storing it (inputs stream eagerly and are not server-checked)."""
    if not isinstance(raw, dict):
        return None

    def level(value) -> int:
        try:
            return min(3, max(1, round(float(value))))
        except (TypeError, ValueError):
            return 3

    title = str(raw.get("title") or fallback_text).strip()[:160]
    description = str(raw.get("description") or fallback_text).strip()[:4000]
    if len(title) < 5 or len(description) < 5:
        return None
    category = raw.get("category") if raw.get("category") in CATEGORIES else None
    subcategory = str(raw.get("subcategory") or "").strip()[:60] or None
    return {
        "title": title,
        "description": description,
        "category": category,
        "subcategory": subcategory,
        "impact": level(raw.get("impact")),
        "urgency": level(raw.get("urgency")),
    }
