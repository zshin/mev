import type { ReactNode } from "react";

const TOKEN =
  /(#.*$)|("(?:[^"\\]|\\.)*")|\b(law|forbid|allow|when|because|scope|emit|bind)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_][A-Za-z0-9_]*)|([{}])|(\s+)|(.)/g;

export function LawsPanel({ source }: { source: string }) {
  const lines = source.replace(/\s+$/, "").split("\n");

  return (
    <section className="laws-shell glass-panel flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-neon shadow-[0_0_10px_#5ce1ff]" />
          <h2 className="font-mono text-[10px] tracking-[0.22em] text-neon">LAWS.bend</h2>
        </div>
        <span className="font-mono text-[10px] tracking-[0.16em] text-white/40">BOUND</span>
      </header>
      <div className="desk-scroll min-h-0 flex-1 overflow-auto px-3 pb-3">
        <div className="rounded-xl border border-white/8 bg-[#070a12]/90">
          <ol className="py-3 font-mono text-[11px] leading-5">
            {lines.map((line, index) => (
              <li key={`${index}-${line}`} className="grid grid-cols-[2.2rem_minmax(0,1fr)] px-2">
                <span className="pr-2 text-right text-white/25">{index + 1}</span>
                <span className="whitespace-pre-wrap break-words">{highlightLine(line)}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-2 px-1 font-mono text-[10px] tracking-[0.08em] text-white/35">
          Caps bind the book. Escalate never leaves this process.
        </p>
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
    if (comment) nodes.push(<span key={key} className="text-white/35">{comment}</span>);
    else if (quote) nodes.push(<span key={key} className="text-mint">{quote}</span>);
    else if (keyword) nodes.push(<span key={key} className="text-neon">{keyword}</span>);
    else if (number) nodes.push(<span key={key} className="text-amber">{number}</span>);
    else if (ident) nodes.push(<span key={key} className="text-ink">{ident}</span>);
    else if (brace) nodes.push(<span key={key} className="text-violet">{brace}</span>);
    else if (space) nodes.push(<span key={key}>{space}</span>);
    else nodes.push(<span key={key} className="text-white/55">{other}</span>);
    index += 1;
    match = TOKEN.exec(line);
  }
  if (nodes.length === 0) nodes.push(<span key="empty"> </span>);
  return nodes;
}
