/**
 * A deliberately small markdown subset for assistant replies: paragraphs, ordered and unordered lists,
 * **bold**, `code` and [links](...). It produces plain data that React renders as elements, so model output
 * can never inject HTML. Links are kept only for app-relative paths and http(s) URLs.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string; external: boolean };

export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

export function safeHref(href: string): { href: string; external: boolean } | null {
  const value = href.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return { href: value, external: false };
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? { href: url.toString(), external: true } : null;
  } catch {
    return null;
  }
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ type: "strong", text: match[1] });
    else if (match[2] !== undefined) out.push({ type: "code", text: match[2] });
    else {
      const label = match[3] ?? "";
      const link = safeHref(match[4] ?? "");
      out.push(link ? { type: "link", text: label, ...link } : { type: "text", text: label });
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const UNORDERED = /^\s*[-*•]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ...list });
    list = null;
  };
  for (const raw of source.split("\n")) {
    const line = raw.replace(/^#{1,6}\s+/, "");
    const ordered = ORDERED.exec(line);
    const unordered = ordered ? null : UNORDERED.exec(line);
    const item = ordered ?? unordered;
    if (item) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(parseInline(item[1] ?? ""));
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
