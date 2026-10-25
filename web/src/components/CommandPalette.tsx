import clsx from "clsx";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useSymbols } from "../api/queries";
import { useMarket } from "../state/market";
import { useTheme } from "../state/theme";
import { useUi } from "../state/ui";
import { NAV_GROUPS } from "./navigation";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, startTour, togglePresent } = useUi();
  const navigate = useNavigate();
  const market = useMarket();
  const { toggle: toggleTheme, mode } = useTheme();
  const { data: symbols } = useSymbols();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const pages = NAV_GROUPS.flatMap((g) => g.items).map((n) => ({ id: `page:${n.to}`, group: "Go to", label: n.label, icon: <n.icon className="size-4" />, run: go(n.to) }));
    const actions: Command[] = [
      { id: "act:compare", group: "Actions", label: `Run comparison on ${market.symbol}`, run: () => navigate("/compare?autorun=1") },
      { id: "act:tour", group: "Actions", label: "Start guided tour", run: startTour },
      { id: "act:present", group: "Actions", label: "Toggle presentation mode", hint: "Shift+P", run: togglePresent },
      { id: "act:theme", group: "Actions", label: `Switch to ${mode === "dark" ? "light" : "dark"} theme`, run: toggleTheme },
      { id: "act:docs", group: "Actions", label: "Open API documentation", run: () => window.open("/docs", "_blank") },
    ];
    const markets = (symbols?.items ?? []).map((s) => ({
      id: `mkt:${s.source}:${s.symbol}`,
      group: "Switch market",
      label: `${s.symbol} · ${s.interval}`,
      hint: s.name,
      run: () => market.setMarket({ symbol: s.symbol, source: s.source, interval: s.interval }),
    }));
    return [...pages, ...actions, ...markets];
  }, [navigate, market, startTour, togglePresent, toggleTheme, mode, symbols]);

  const q = query.trim().toLowerCase();
  const results = q ? commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(q)) : commands;

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setIndex(0);
    }
  }, [paletteOpen]);
  useEffect(() => setIndex(0), [query]);

  if (!paletteOpen) return null;
  const close = () => setPaletteOpen(false);
  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    close();
    cmd.run();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={close}>
      <div className="animate-in w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                runAt(index);
              } else if (e.key === "Escape") {
                close();
              }
            }}
            placeholder="Search pages, markets and actions…"
            className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-muted uppercase">{header}</div>}
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => runAt(i)}
                  className={clsx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm", i === index ? "bg-accent-soft text-fg" : "text-fg-2")}
                >
                  <span className="text-muted">{c.icon}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="truncate text-xs text-muted">{c.hint}</span>}
                  {i === index && <CornerDownLeft className="size-3.5 text-muted" />}
                </button>
              </div>
            );
          })}
          {!results.length && <div className="px-3 py-8 text-center text-sm text-muted">No matches.</div>}
        </div>
      </div>
    </div>
  );
}
