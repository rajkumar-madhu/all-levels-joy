"""Support assistant (legacy /assistant). Conversations belong to one user; RLS on ai_chat_threads and
ai_chat_messages keeps them private. Replies stream as server-sent events from the ASGI app.

The request transaction (ATOMIC_REQUESTS) commits the user's message before streaming starts; the reply
is saved afterwards in its own transaction, again as the caller.
"""

import json
import logging

from asgiref.sync import sync_to_async
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.http import Http404, StreamingHttpResponse
from rest_framework import serializers, status
from rest_framework.response import Response

from apps.core.db import act_as_user, call_function, execute, fetch_all, fetch_one, jsonb
from apps.core.views import CallerAPIView

from . import llm
from .grounding import build_context, clean_proposal, link_citations

log = logging.getLogger(__name__)
NEW_TITLE = "New conversation"
MESSAGE_COLUMNS = "id, role, content, suggested_ticket, created_incident_id, created_at"


class MessageSerializer(serializers.Serializer):
    text = serializers.CharField(min_length=1, max_length=4000)


def sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, cls=DjangoJSONEncoder)}\n\n"


def save_reply(user_id: str, org_id: str, thread_id: str, question: str, reply: str, proposal) -> dict:
    with transaction.atomic():
        act_as_user(user_id)
        row = fetch_one(
            "INSERT INTO public.ai_chat_messages(thread_id, organization_id, user_id, role, content, suggested_ticket) "
            f"VALUES (%s, %s, %s, 'assistant', %s, %s) RETURNING {MESSAGE_COLUMNS}",
            [thread_id, org_id, user_id, reply, jsonb(proposal) if proposal else None],
        )
        execute(
            "UPDATE public.ai_chat_threads SET updated_at = now(), "
            "title = CASE WHEN title = %s THEN left(%s, 60) ELSE title END WHERE id = %s AND user_id = %s",
            [NEW_TITLE, question, thread_id, user_id],
        )
    return row


class ThreadListView(CallerAPIView):
    policy_actions = {"GET": "assistant.use", "POST": "assistant.use"}

    def get(self, request, org_id):
        rows = fetch_all(
            "SELECT id, title, created_at, updated_at FROM public.ai_chat_threads "
            "WHERE organization_id = %s AND user_id = %s ORDER BY updated_at DESC LIMIT 50",
            [self.org_id, request.user.user_id],
        )
        return Response({"results": rows, "configured": llm.is_configured()})

    def post(self, request, org_id):
        row = fetch_one(
            "INSERT INTO public.ai_chat_threads(organization_id, user_id, title) VALUES (%s, %s, %s) "
            "RETURNING id, title, created_at, updated_at",
            [self.org_id, request.user.user_id, NEW_TITLE],
        )
        return Response(row, status=status.HTTP_201_CREATED)


class ThreadDetailView(CallerAPIView):
    policy_actions = {"GET": "assistant.use", "DELETE": "assistant.use"}

    def thread(self, thread_id) -> dict:
        row = fetch_one(
            "SELECT id, title, created_at, updated_at FROM public.ai_chat_threads "
            "WHERE organization_id = %s AND id = %s AND user_id = %s",
            [self.org_id, str(thread_id), self.request.user.user_id],
        )
        if not row:
            raise Http404
        return row

    def get(self, request, org_id, thread_id):
        thread = self.thread(thread_id)
        messages = fetch_all(
            f"SELECT {MESSAGE_COLUMNS} FROM public.ai_chat_messages WHERE thread_id = %s ORDER BY created_at, id",
            [str(thread_id)],
        )
        return Response({"thread": thread, "messages": messages, "configured": llm.is_configured()})

    def delete(self, request, org_id, thread_id):
        self.thread(thread_id)
        execute(
            "DELETE FROM public.ai_chat_messages WHERE thread_id = %s AND user_id = %s",
            [str(thread_id), request.user.user_id],
        )
        execute(
            "DELETE FROM public.ai_chat_threads WHERE id = %s AND user_id = %s", [str(thread_id), request.user.user_id]
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageView(ThreadDetailView):
    """POST a question; the response is an event stream: `delta` {text}, then `done` {message} or `error`."""

    policy_actions = {"POST": "assistant.use"}

    def post(self, request, org_id, thread_id):
        if not llm.is_configured():
            return Response({"detail": "The AI assistant is not configured yet."}, status=503)
        data = MessageSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        question = data.validated_data["text"].strip()
        thread = self.thread(thread_id)
        history = fetch_all(
            "SELECT role, content FROM (SELECT role, content, created_at, id FROM public.ai_chat_messages "
            "WHERE thread_id = %s ORDER BY created_at DESC, id DESC LIMIT 40) recent ORDER BY created_at, id",
            [str(thread["id"])],
        )
        execute(
            "INSERT INTO public.ai_chat_messages(thread_id, organization_id, user_id, role, content) "
            "VALUES (%s, %s, %s, 'user', %s)",
            [str(thread["id"]), self.org_id, request.user.user_id, question],
        )
        system, ranked = build_context(self.org_id, question)
        messages = [
            {"role": "assistant" if row["role"] == "assistant" else "user", "content": row["content"]}
            for row in history
            if row["content"]
        ]
        messages.append({"role": "user", "content": question})
        # The model call may only start once the question is committed, so it runs in the stream below.
        response = StreamingHttpResponse(
            self.events(request.user.user_id, str(thread["id"]), question, system, messages, ranked),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

    async def events(self, user_id, thread_id, question, system, messages, ranked):
        import anthropic

        try:
            async with llm.stream_reply(system, messages) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and getattr(event.delta, "type", "") == "text_delta":
                        yield sse("delta", {"text": event.delta.text})
                final = await stream.get_final_message()
        except anthropic.RateLimitError:
            yield sse("error", {"detail": "The assistant is busy. Try again in a minute."})
            return
        except anthropic.APIStatusError as error:
            log.error("assistant API error %s", error.status_code)
            yield sse("error", {"detail": "The assistant could not answer right now. Try again."})
            return
        except anthropic.APIConnectionError:
            yield sse("error", {"detail": "The assistant is unreachable right now. Try again."})
            return

        proposal = None
        reply = ""
        if final.stop_reason == "refusal":
            reply = "I can't help with that. You can still report the issue from the service catalogue."
        else:
            reply = "".join(block.text for block in final.content if block.type == "text").strip()
            for block in final.content:
                if block.type == "tool_use" and block.name == "propose_ticket":
                    proposal = clean_proposal(block.input, question)
        if not reply:
            reply = (
                "I can raise a ticket for this. Review the details below."
                if proposal
                else "I could not generate an answer. Please try rephrasing."
            )
        reply = link_citations(reply, ranked)
        message = await sync_to_async(save_reply)(user_id, self.org_id, thread_id, question, reply, proposal)
        yield sse("done", {"message": message})


class TicketFromMessageView(CallerAPIView):
    """Creates the incident the assistant proposed, once the user confirms it."""

    policy_actions = {"POST": "assistant.use"}

    def post(self, request, org_id, message_id):
        message = fetch_one(
            "SELECT id, suggested_ticket, created_incident_id FROM public.ai_chat_messages "
            "WHERE organization_id = %s AND id = %s AND user_id = %s FOR UPDATE",
            [self.org_id, str(message_id), request.user.user_id],
        )
        if not message:
            raise Http404
        if message["created_incident_id"]:
            return Response({"detail": "A ticket was already created."}, status=400)
        proposal = message["suggested_ticket"]
        if not proposal:
            return Response({"detail": "There is no ticket proposal on this message."}, status=400)
        incident = call_function(
            "itsm_self_service_incident",
            [
                ("_org_id", self.org_id, "uuid"),
                ("_title", proposal["title"], "text"),
                ("_description", proposal["description"], "text"),
                ("_impact", proposal["impact"], "smallint"),
                ("_urgency", proposal["urgency"], "smallint"),
                ("_category", proposal.get("category") or "", "text"),
                ("_subcategory", proposal.get("subcategory") or "", "text"),
                ("_contact_type", "chat", "text"),
            ],
        )
        execute(
            "UPDATE public.ai_chat_messages SET created_incident_id = %s WHERE id = %s AND user_id = %s",
            [incident["id"], message["id"], request.user.user_id],
        )
        return Response(incident, status=status.HTTP_201_CREATED)
