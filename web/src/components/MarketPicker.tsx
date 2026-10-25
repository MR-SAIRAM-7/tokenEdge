import clsx from "clsx";
import { Bitcoin, Building2, ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMarketsOverview, useSymbols } from "../api/queries";
import type { Source } from "../api/types";
import { pct, price } from "../lib/format";
import { useMarket } from "../state/market";
import { Sparkline } from "./Sparkline";
import { Button, Input, Select } from "./ui";

const INTERVALS: Record<Source, string[]> = { yfinance: ["1d", "1wk", "1h"], ccxt: ["1h", "4h", "1d"] };

export function MarketPicker() {
  const market = useMarket();
  const { data: symbols } = useSymbols();
  const { data: overview } = useMarketsOverview();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ symbol: "", source: "yfinance" as Source, interval: "1d" });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = useMemo(() => {
    const ov = new Map((overview ?? []).map((o) => [`${o.source}|${o.symbol}|${o.interval}`, o]));
    return (symbols?.items ?? []).map((s) => ({ ...s, ov: ov.get(`${s.source}|${s.symbol}|${s.interval}`) }));
  }, [symbols, overview]);
  const q = query.trim().toLowerCase();
  const filtered = items.filter((i) => !q || i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  const current = items.find((i) => i.symbol === market.symbol && i.source === market.source && i.interval === market.interval);

  const choose = (symbol: string, source: Source, interval: string) => {
    market.setMarket({ symbol, source, interval });
    setOpen(false);
    setQuery("");
    setCustom(false);
  };

  return (
    <div className="relative" ref={box} data-tour="market">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2.5 rounded-lg border border-line bg-panel px-2.5 text-left transition-colors hover:border-muted/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {market.source === "ccxt" ? <Bitcoin className="size-4 text-muted" /> : <Building2 className="size-4 text-muted" />}
        <span className="text-sm font-semibold text-fg">{market.symbol}</span>
        <span className="hidden text-xs text-muted sm:inline">{market.interval}</span>
        {current?.ov && (
          <span className="hidden items-center gap-1.5 text-xs md:flex">
            <span className="tabular text-fg-2">{price(current.ov.last_close)}</span>
            <span className={clsx("tabular", (current.ov.change_1d ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(current.ov.change_1d, 2, true)}</span>
          </span>
        )}
        <ChevronDown className="size-4 text-muted" />
      </button>

      {open && (
        <div className="animate-in absolute top-11 left-0 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel shadow-pop">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol or name"
              className="h-11 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            />
          </div>
          <div className="max-h-[22rem] overflow-y-auto p-1.5" role="listbox">
            {(["equity", "crypto"] as const).map((cls) => {
              const group = filtered.filter((i) => i.asset_class === cls);
              if (!group.length) return null;
              return (
                <div key={cls} className="mb-1">
                  <div className="px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-muted uppercase">{cls === "equity" ? "Equities · Yahoo Finance" : "Crypto · ccxt"}</div>
                  {group.map((i) => {
                    const active = current?.symbol === i.symbol && current.interval === i.interval;
                    const up = (i.ov?.change_30d ?? 0) >= 0;
                    return (
                      <button
                        key={`${i.source}${i.symbol}`}
                        role="option"
                        aria-selected={active}
                        onClick={() => choose(i.symbol, i.source, i.interval)}
                        className={clsx("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors", active ? "bg-accent-soft" : "hover:bg-panel-2")}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
                            {i.symbol}
                            <span className="text-[11px] font-normal text-muted">{i.interval}</span>
                          </div>
                          <div className="truncate text-xs text-muted">{i.name}</div>
                        </div>
                        {i.ov && <Sparkline values={i.ov.sparkline} width={72} height={24} color={up ? "var(--pos)" : "var(--neg)"} />}
                        <div className="w-20 text-right">
                          <div className="tabular text-xs text-fg">{price(i.ov?.last_close)}</div>
                          <div className={clsx("tabular text-[11px]", (i.ov?.change_1d ?? 0) >= 0 ? "text-pos" : "text-neg")}>{pct(i.ov?.change_1d, 2, true)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!filtered.length && <div className="px-3 py-6 text-center text-sm text-muted">No bundled market matches. Add it as a custom symbol below.</div>}
          </div>
          <div className="border-t border-line p-2">
            {custom ? (
              <form
                className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.symbol.trim()) choose(draft.symbol.trim().toUpperCase(), draft.source, draft.interval);
                }}
              >
                <Input className="h-8" autoFocus placeholder={draft.source === "ccxt" ? "ADA/USDT" : "INFY.NS"} value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} />
                <Select
                  className="h-8 w-24"
                  value={draft.source}
                  onChange={(e) => {
                    const source = e.target.value as Source;
                    setDraft({ ...draft, source, interval: INTERVALS[source][0] });
                  }}
                >
                  <option value="yfinance">Yahoo</option>
                  <option value="ccxt">Crypto</option>
                </Select>
                <Select className="h-8 w-16" value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value })}>
                  {INTERVALS[draft.source].map((iv) => (
                    <option key={iv}>{iv}</option>
                  ))}
                </Select>
                <Button size="sm" variant="primary" type="submit">
                  Load
                </Button>
              </form>
            ) : (
              <button onClick={() => setCustom(true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-fg-2 hover:bg-panel-2 hover:text-fg">
                <Plus className="size-4" /> Other symbol (any Yahoo ticker or ccxt pair)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
