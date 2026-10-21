import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventParser } from "./sse.ts";

test("events split across chunks are parsed once complete", () => {
  const parse = createEventParser();
  assert.deepEqual(parse('event: delta\ndata: {"text": "Hel'), []);
  assert.deepEqual(parse('lo"}\n\nevent: done\ndata: {"message": {"id": "1"}}\n\n'), [
    { event: "delta", data: { text: "Hello" } },
    { event: "done", data: { message: { id: "1" } } },
  ]);
});

test("CRLF line endings and comments are tolerated", () => {
  const parse = createEventParser();
  assert.deepEqual(parse(': keep-alive\r\n\r\nevent: error\r\ndata: {"detail": "busy"}\r\n\r\n'), [
    { event: "error", data: { detail: "busy" } },
  ]);
});
