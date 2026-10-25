import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type {
  CostPreset,
  Health,
  Instrument,
  ModelDetail,
  ModelSummary,
  RunSummary,
  Splits,
  StrategyInfo,
} from "./types";

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/health"), refetchInterval: 30_000 });

export const useSymbols = () =>
  useQuery({
    queryKey: ["symbols"],
    queryFn: () => api.get<{ items: Instrument[]; offline: boolean }>("/symbols"),
    staleTime: 60_000,
  });

export const useStrategies = () =>
  useQuery({
    queryKey: ["strategies"],
    queryFn: () => api.get<{ items: StrategyInfo[] }>("/strategies").then((r) => r.items),
    staleTime: Infinity,
  });

export const usePresets = () =>
  useQuery({
    queryKey: ["presets"],
    queryFn: () => api.get<{ items: CostPreset[] }>("/cost-presets").then((r) => r.items),
    staleTime: Infinity,
  });

export const useSplits = () =>
  useQuery({ queryKey: ["splits"], queryFn: () => api.get<Splits>("/splits"), staleTime: Infinity });

export const useModels = () =>
  useQuery({
    queryKey: ["models"],
    queryFn: () => api.get<{ items: ModelSummary[] }>("/models").then((r) => r.items),
    staleTime: 15_000,
  });

export const useModel = (id: string | undefined) =>
  useQuery({
    queryKey: ["model", id],
    queryFn: () => api.get<ModelDetail>(`/models/${encodeURIComponent(id ?? "")}`),
    enabled: !!id,
  });

export const useRuns = (params: { symbol?: string; kind?: string; limit?: number; offset?: number } = {}) =>
  useQuery({
    queryKey: ["runs", params],
    queryFn: () => api.get<{ total: number; items: RunSummary[] }>("/runs", params),
  });
