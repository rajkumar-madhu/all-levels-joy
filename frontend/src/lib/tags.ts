/** Same tag normalisation as the API (and the legacy app): lower-case, hyphenated, unique, at most 12. */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 12);
}
