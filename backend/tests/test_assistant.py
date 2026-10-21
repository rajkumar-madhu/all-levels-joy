"""Support assistant. The Anthropic client is replaced with a fake: tests never call the real API."""

import json
from types import SimpleNamespace

import pytest

from apps.assistant import llm
from apps.assistant.grounding import clean_proposal, link_citations, rank_articles

from .conftest import seed

pytestmark = [
    pytest.mark.django_db(transaction=True),
    # The WSGI test client buffers the async event stream; production serves it over ASGI (tested below).
    pytest.mark.filterwarnings("ignore:StreamingHttpResponse must consume asynchronous iterators"),
]


class FakeStream:
    def __init__(self, text: str, proposal: dict | None = None, stop: str = "end_turn"):
        self.text, self.proposal, self.stop = text, proposal, stop

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def __aiter__(self):
        for word in self.text.split(" "):
            yield SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=word + " "))

    async def get_final_message(self):
        content = [SimpleNamespace(type="text", text=self.text)]
        if self.proposal is not None:
            content.append(SimpleNamespace(type="tool_use", name="propose_ticket", input=self.proposal))
        return SimpleNamespace(stop_reason=self.stop, content=content)


@pytest.fixture
def fake_model(settings, monkeypatch):
    settings.ANTHROPIC_API_KEY = "test-key"
    calls = []
    reply = {"stream": FakeStream("Restart the VPN client.")}

    def stream_reply(system, messages):
        calls.append({"system": system, "messages": messages})
        return reply["stream"]

    monkeypatch.setattr(llm, "stream_reply", stream_reply)
    return SimpleNamespace(calls=calls, set=lambda stream: reply.update(stream=stream))


def events(response) -> list[tuple[str, dict]]:
    assert response["Content-Type"] == "text/event-stream"
    body = b"".join(list(response)).decode()
    parsed = []
    for chunk in body.strip().split("\n\n"):
        name = chunk.split("\n")[0].removeprefix("event: ")
        data = json.loads(chunk.split("\n")[1].removeprefix("data: "))
        parsed.append((name, data))
    return parsed


def ask(client, org, thread_id, text):
    return client.post(
        f"/api/v1/orgs/{org}/assistant/threads/{thread_id}/messages",
        {"text": text},
        format="json",
        HTTP_ACCEPT="text/event-stream, application/json",
    )


def new_thread(client, org):
    created = client.post(f"/api/v1/orgs/{org}/assistant/threads", {}, format="json")
    assert created.status_code == 201, created.content
    return created.json()["id"]


def test_answers_stream_and_are_grounded_in_published_knowledge(org, make_user, opa, fake_model):
    article = str(
        seed(
            "INSERT INTO public.knowledge_articles(organization_id, number, title, summary, content, category, "
            "status, tags) VALUES (%s, 'KB009001', 'Fix VPN drops', 'Reconnect steps', 'Open the VPN client', "
            "'network', 'published', ARRAY['vpn']) RETURNING id",
            [org],
        )[0]
    )
    seed(
        "INSERT INTO public.knowledge_articles(organization_id, number, title, content, category, status) "
        "VALUES (%s, 'KB009002', 'Draft VPN notes', 'secret draft', 'network', 'draft')",
        [org],
    )
    user = make_user(org)
    thread_id = new_thread(user, org)
    fake_model.set(FakeStream("Follow KB009001 to reconnect."))

    stream = events(ask(user, org, thread_id, "My VPN keeps dropping"))
    assert [name for name, _ in stream[:-1]] == ["delta"] * 4
    name, done = stream[-1]
    assert name == "done"
    assert done["message"]["content"] == f"Follow [KB009001](/knowledge/{article}) to reconnect."

    system = fake_model.calls[0]["system"]
    assert "Fix VPN drops" in system and "secret draft" not in system
    assert fake_model.calls[0]["messages"] == [{"role": "user", "content": "My VPN keeps dropping"}]

    thread = user.get(f"/api/v1/orgs/{org}/assistant/threads/{thread_id}").json()
    assert thread["thread"]["title"] == "My VPN keeps dropping"
    assert [m["role"] for m in thread["messages"]] == ["user", "assistant"]

    # The next question carries the conversation so far.
    events(ask(user, org, thread_id, "Still broken"))
    assert [m["role"] for m in fake_model.calls[1]["messages"]] == ["user", "assistant", "user"]


def test_proposed_ticket_is_created_only_on_confirmation(org, make_user, opa, fake_model):
    user = make_user(org)
    thread_id = new_thread(user, org)
    fake_model.set(
        FakeStream(
            "This needs the network team.",
            {
                "title": "Office Wi-Fi down on floor 3",
                "description": "No one on floor 3 can connect since 9am",
                "category": "network",
                "subcategory": "wifi",
                "impact": 1,
                "urgency": 7,
            },
        )
    )
    message = events(ask(user, org, thread_id, "Wifi is down for the whole floor"))[-1][1]["message"]
    assert message["suggested_ticket"]["urgency"] == 3  # out-of-range model input is clamped
    assert seed("SELECT count(*) FROM public.incidents WHERE organization_id = %s", [org])[0] == 0

    url = f"/api/v1/orgs/{org}/assistant/messages/{message['id']}/ticket"
    created = user.post(url, {}, format="json")
    assert created.status_code == 201, created.content
    contact = seed("SELECT contact_type FROM public.incidents WHERE id = %s", [created.json()["id"]])[0]
    assert contact == "chat"
    assert user.post(url, {}, format="json").status_code == 400


def test_threads_are_private_to_their_owner(org, make_user, opa, fake_model):
    owner, other = make_user(org), make_user(org)
    thread_id = new_thread(owner, org)
    events(ask(owner, org, thread_id, "Printer jammed"))
    base = f"/api/v1/orgs/{org}/assistant/threads"
    assert other.get(base).json()["results"] == []
    assert other.get(f"{base}/{thread_id}").status_code == 404
    assert ask(other, org, thread_id, "hello").status_code == 404
    assert other.delete(f"{base}/{thread_id}").status_code == 404
    message_id = owner.get(f"{base}/{thread_id}").json()["messages"][1]["id"]
    assert (
        other.post(f"/api/v1/orgs/{org}/assistant/messages/{message_id}/ticket", {}, format="json").status_code == 404
    )
    assert owner.delete(f"{base}/{thread_id}").status_code == 204
    assert owner.get(f"{base}/{thread_id}").status_code == 404


def test_refusals_and_missing_configuration(org, make_user, opa, fake_model, settings):
    user = make_user(org)
    thread_id = new_thread(user, org)
    fake_model.set(FakeStream("", {"title": "x"}, stop="refusal"))
    done = events(ask(user, org, thread_id, "something odd"))[-1][1]["message"]
    assert done["suggested_ticket"] is None and "can't help" in done["content"]

    settings.ANTHROPIC_API_KEY = ""
    response = ask(user, org, thread_id, "hello")
    assert response.status_code == 503
    assert user.get(f"/api/v1/orgs/{org}/assistant/threads").json()["configured"] is False


def test_non_members_cannot_use_the_assistant(org, make_user, opa):
    from .conftest import create_org

    stranger = make_user(create_org("Other"))
    assert stranger.get(f"/api/v1/orgs/{org}/assistant/threads").status_code == 403


def test_events_stream_incrementally_over_asgi(org, make_user, opa, fake_model):
    from asgiref.sync import async_to_sync
    from django.test import AsyncClient

    user = make_user(org)
    thread_id = new_thread(user, org)
    token = user._credentials["HTTP_AUTHORIZATION"]

    async def collect():
        response = await AsyncClient().post(
            f"/api/v1/orgs/{org}/assistant/threads/{thread_id}/messages",
            {"text": "Printer offline"},
            content_type="application/json",
            headers={"Authorization": token, "Accept": "text/event-stream, application/json"},
        )
        assert response.status_code == 200, (
            b"".join([c async for c in response.streaming_content]) if response.streaming else response.content
        )
        return [chunk async for chunk in response.streaming_content]

    chunks = async_to_sync(collect)()
    assert len(chunks) == 5  # four word deltas and the final message, each flushed on its own
    assert chunks[-1].startswith(b"event: done")


def test_grounding_helpers():
    articles = [
        {
            "id": "a",
            "number": "KB1",
            "title": "VPN setup",
            "category": "network",
            "tags": ["vpn"],
            "summary": "",
            "content": "",
        },
        {
            "id": "b",
            "number": "KB2",
            "title": "Printer",
            "category": "hardware",
            "tags": [],
            "summary": "",
            "content": "",
        },
    ]
    assert [a["number"] for a in rank_articles("vpn not working", articles)] == ["KB1"]
    assert (
        link_citations("See KB1 and [KB1](/knowledge/a).", articles[:1])
        == "See [KB1](/knowledge/a) and [KB1](/knowledge/a)."
    )
    assert clean_proposal({"title": "ab"}, "x") is None
    assert clean_proposal("not a dict", "x") is None
