import { Fragment } from "react";
import { Link } from "react-router";
import { parseMarkdown, type Inline } from "@/lib/markdown";

/** Renders the assistant's markdown subset as React elements; raw HTML is never interpreted. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      {parseMarkdown(source).map((block, index) =>
        block.type === "paragraph" ? (
          <p key={index}>
            <Inlines content={block.content} />
          </p>
        ) : block.ordered ? (
          <ol key={index} className="ml-5 list-decimal space-y-1">
            {block.items.map((item, i) => (
              <li key={i}>
                <Inlines content={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} className="ml-5 list-disc space-y-1">
            {block.items.map((item, i) => (
              <li key={i}>
                <Inlines content={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Inlines({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((part, index) => {
        if (part.type === "strong") return <strong key={index}>{part.text}</strong>;
        if (part.type === "code")
          return (
            <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
              {part.text}
            </code>
          );
        if (part.type === "link")
          return part.external ? (
            <a key={index} href={part.href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
              {part.text}
            </a>
          ) : (
            <Link key={index} to={part.href} className="text-primary underline">
              {part.text}
            </Link>
          );
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}
