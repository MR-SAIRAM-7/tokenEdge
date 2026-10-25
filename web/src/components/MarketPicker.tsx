import { useState } from "react";
import { useSymbols } from "../api/queries";
import type { Source } from "../api/types";
import { useMarket } from "../state/market";
import { Button, Input, Select } from "./ui";

const INTERVALS: Record<Source, string[]> = { yfinance: ["1d", "1wk", "1h"], ccxt: ["1h", "4h", "1d"] };

export function MarketPicker() {
  const market = useMarket();
  const { data } = useSymbols();
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ symbol: "", source: "yfinance" as Source, interval: "1d" });
  const items = data?.items ?? [];
  const known = items.find((i) => i.symbol === market.symbol && i.source === market.source && i.interval === market.interval);

  if (custom) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.symbol.trim()) return;
          market.setMarket({ symbol: draft.symbol.trim().toUpperCase(), source: draft.source, interval: draft.interval });
          setCustom(false);
        }}
      >
        <Input
          autoFocus
          className="h-8 w-36"
          placeholder={draft.source === "ccxt" ? "e.g. ADA/USDT" : "e.g. INFY.NS"}
          value={draft.symbol}
          onChange={(e) => setDraft({ ...draft, symbol: e.target.value })}
          aria-label="Symbol"
        />
        <Select
          className="h-8 w-28"
          value={draft.source}
          onChange={(e) => {
            const source = e.target.value as Source;
            setDraft({ ...draft, source, interval: INTERVALS[source][0] });
          }}
          aria-label="Data source"
        >
          <option value="yfinance">Yahoo</option>
          <option value="ccxt">Crypto</option>
        </Select>
        <Select className="h-8 w-20" value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value })} aria-label="Interval">
          {INTERVALS[draft.source].map((iv) => (
            <option key={iv}>{iv}</option>
          ))}
        </Select>
        <Button size="sm" variant="primary" type="submit">
          Load
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setCustom(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  const value = known ? `${known.source}|${known.symbol}|${known.interval}` : "__current";
  return (
    <div className="flex items-center gap-2">
      <Select
        className="h-8 w-[min(16rem,52vw)]"
        value={value}
        aria-label="Market"
        onChange={(e) => {
          if (e.target.value === "__custom") {
            setDraft({ symbol: "", source: market.source, interval: market.interval });
            setCustom(true);
            return;
          }
          if (e.target.value === "__current") return;
          const [source, symbol, interval] = e.target.value.split("|");
          market.setMarket({ source: source as Source, symbol, interval });
        }}
      >
        {!known && (
          <option value="__current">
            {market.symbol} · {market.interval} (custom)
          </option>
        )}
        <optgroup label="Equities (Yahoo Finance)">
          {items
            .filter((i) => i.source === "yfinance")
            .map((i) => (
              <option key={i.symbol} value={`${i.source}|${i.symbol}|${i.interval}`}>
                {i.symbol} · {i.interval} — {i.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Crypto (ccxt)">
          {items
            .filter((i) => i.source === "ccxt")
            .map((i) => (
              <option key={i.symbol} value={`${i.source}|${i.symbol}|${i.interval}`}>
                {i.symbol} · {i.interval} — {i.name}
              </option>
            ))}
        </optgroup>
        <option value="__custom">Other symbol…</option>
      </Select>
    </div>
  );
}
