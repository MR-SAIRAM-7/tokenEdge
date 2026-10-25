import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useDemoStatus } from "../api/queries";
import type { DemoStatus } from "../api/types";
import { useToast } from "./Toast";
import { Button } from "./ui";

/** Starts demo seeding and refreshes every run-based view when it finishes. */
export function useDemoSeed() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useDemoStatus();
  const prev = useRef<string | undefined>(undefined);

  useEffect(() => {
    const state = status.data?.state;
    if (prev.current === "running" && state === "done") {
      ["runs", "findings", "models", "demo-status"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const errs = status.data?.errors.length ?? 0;
      toast(errs ? `Demo data loaded with ${errs} skipped scenario(s).` : "Demo data loaded: comparisons and backtests are ready.", errs ? "info" : "ok");
    }
    prev.current = state;
  }, [status.data, qc, toast]);

  const start = useMutation({
    mutationFn: (replace: boolean) => api.post<DemoStatus>(`/demo/seed${replace ? "?replace=true" : ""}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demo-status"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const running = status.data?.state === "running";
  return { status: status.data, running, start: (replace = false) => start.mutate(replace) };
}

export function DemoProgress({ status }: { status: DemoStatus | undefined }) {
  if (!status || status.state !== "running") return null;
  const pct = status.total ? Math.round((status.done / status.total) * 100) : 5;
  return (
    <div className="w-full">
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{status.current || "Preparing scenarios…"}</span>
        <span className="tabular">
          {status.done}/{status.total || "…"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
      </div>
    </div>
  );
}

export function DemoSeedCard({ compact = false }: { compact?: boolean }) {
  const { status, running, start } = useDemoSeed();
  return (
    <div className={compact ? "space-y-3" : "flex flex-col items-center gap-4 px-6 py-10 text-center"}>
      {!compact && (
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Database className="size-6" />
        </div>
      )}
      {!compact && (
        <div>
          <div className="text-base font-semibold text-fg">Load the demo results</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Runs a curated set of real comparisons and backtests on the bundled market data (SPY, AAPL, RELIANCE, TCS, BTC) with every registered model. Takes about a minute.
          </p>
        </div>
      )}
      {running ? (
        <div className="w-full max-w-sm">
          <DemoProgress status={status} />
        </div>
      ) : (
        <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => start(false)}>
          Load demo data
        </Button>
      )}
    </div>
  );
}
