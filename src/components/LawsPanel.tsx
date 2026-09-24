import type { ReactNode } from "react";

const TOKEN =
  /(#.*$)|("(?:[^"\\]|\\.)*")|\b(law|forbid|allow|when|because|scope|emit|bind)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_][A-Za-z0-9_]*)|([{}])|(\s+)|(.)/g;

export function LawsPanel({ source }: { source: string }) {
  const lines = source.replace(/\s+$/, "").split("\n");

  return (
    <section className="glass-panel flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between px-3.5 pt-3 pb-2">
        <h2 className="font-mono text-[12px] text-zinc-200">LAWS.bend</h2>
        <span className="text-[11px] text-zinc-500">Bound</span>
      </header>
      <div className="desk-scroll min-h-0 flex-1 overflow-auto px-3 pb-3">
        <div className="well">
          <ol className="py-2.5 font-mono text-[11px] leading-5">
            {lines.map((line, index) => (
              <li key={`${index}-${line}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] px-2.5">
                <span className="pr-2 text-right text-zinc-600">{index + 1}</span>
                <span className="whitespace-pre-wrap break-words">{highlightLine(line)}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-2 px-0.5 text-[11px] text-zinc-500">Caps bind the book. Escalate stays in this process.</p>
      </div>
    </section>
  );
}

function highlightLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  TOKEN.lastIndex = 0;
  let match = TOKEN.exec(line);
  let index = 0;
  while (match) {
    const [raw, comment, quote, keyword, number, ident, brace, space, other] = match;
    const key = `${index}-${raw}`;
    if (comment) nodes.push(<span key={key} className="text-zinc-600">{comment}</span>);
    else if (quote) nodes.push(<span key={key} className="text-zinc-300">{quote}</span>);
    else if (keyword) nodes.push(<span key={key} className="text-zinc-100">{keyword}</span>);
    else if (number) nodes.push(<span key={key} className="text-zinc-200">{number}</span>);
    else if (ident) nodes.push(<span key={key} className="text-zinc-400">{ident}</span>);
    else if (brace) nodes.push(<span key={key} className="text-zinc-500">{brace}</span>);
    else if (space) nodes.push(<span key={key}>{space}</span>);
    else nodes.push(<span key={key} className="text-zinc-500">{other}</span>);
    index += 1;
    match = TOKEN.exec(line);
  }
  if (nodes.length === 0) nodes.push(<span key="empty"> </span>);
  return nodes;
}
