import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown, safeHref } from "./markdown.ts";

test("paragraphs, lists and inline marks", () => {
  const blocks = parseMarkdown("Try this:\n\n1. Open **Settings**\n2. Run `vpn --reset`\n\n- See [KB1](/knowledge/abc)");
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: "paragraph", content: [{ type: "text", text: "Try this:" }] });
  assert.equal(blocks[1]?.type, "list");
  assert.deepEqual(blocks[2], {
    type: "list",
    ordered: false,
    items: [[{ type: "text", text: "See " }, { type: "link", text: "KB1", href: "/knowledge/abc", external: false }]],
  });
});

test("unsafe links become plain text and HTML stays text", () => {
  assert.deepEqual(parseInline("[click](javascript:void0)"), [{ type: "text", text: "click" }]);
  assert.equal(safeHref("//evil.example"), null);
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>"), [{ type: "text", text: "<img src=x onerror=alert(1)>" }]);
  assert.deepEqual(safeHref("https://status.example.com"), { href: "https://status.example.com/", external: true });
});
