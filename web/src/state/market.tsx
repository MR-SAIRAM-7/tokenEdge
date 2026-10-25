import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Source } from "../api/types";
import { load, save } from "../lib/storage";

export interface Market {
  symbol: string;
  source: Source;
  interval: string;
}

interface MarketCtx extends Market {
  setMarket: (m: Market) => void;
}

const DEFAULT: Market = { symbol: "SPY", source: "yfinance", interval: "1d" };
const Ctx = createContext<MarketCtx>({ ...DEFAULT, setMarket: () => {} });

export function MarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarket] = useState<Market>(() => load<Market>("tokenedge.market", DEFAULT));
  useEffect(() => save("tokenedge.market", market), [market]);
  return <Ctx.Provider value={{ ...market, setMarket }}>{children}</Ctx.Provider>;
}

export const useMarket = () => useContext(Ctx);

export const marketKey = (m: Market) => `${m.source}:${m.symbol}:${m.interval}`;
