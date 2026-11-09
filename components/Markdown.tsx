import { parseMarkdown, type Inline } from "@/lib/markdown";

function Runs({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((i, k) => {
        let node: React.ReactNode = i.text;
        if (i.bold) node = <strong>{node}</strong>;
        if (i.italic) node = <em>{node}</em>;
        if (i.href) node = <a href={i.href}>{node}</a>;
        return <span key={k}>{node}</span>;
      })}
    </>
  );
}

/** Renders the Markdown subset of lib/markdown.ts (the same structure the DOCX export uses). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={className}>
      {parseMarkdown(source).map((b, k) => {
        if (b.type === "heading") {
          const H = `h${b.level}` as "h1" | "h2" | "h3";
          return (
            <H key={k}>
              <Runs content={b.content} />
            </H>
          );
        }
        if (b.type === "paragraph")
          return (
            <p key={k}>
              <Runs content={b.content} />
            </p>
          );
        if (b.type === "list")
          return (
            <ul key={k}>
              {b.items.map((item, n) => (
                <li key={n}>
                  <Runs content={item} />
                </li>
              ))}
            </ul>
          );
        return <hr key={k} />;
      })}
    </div>
  );
}
