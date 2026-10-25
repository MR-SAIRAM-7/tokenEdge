import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Play } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useStudyStatus } from "../api/queries";
import type { StudyStatus } from "../api/types";
import { useToast } from "./Toast";
import { Button } from "./ui";

/** Starts the research study and refreshes every run-based view when it finishes. */
export function useStudy() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useStudyStatus();
  const prev = useRef<string | undefined>(undefined);

  useEffect(() => {
    const state = status.data?.state;
    if (prev.current === "running" && state === "done") {
      ["runs", "findings", "models", "study-status"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const errs = status.data?.errors.length ?? 0;
      toast(errs ? `Study finished with ${errs} skipped scenario(s).` : "Study finished: comparisons and backtests are in Run History.", errs ? "info" : "ok");
    }
    prev.current = state;
  }, [status.data, qc, toast]);

  const start = useMutation({
    mutationFn: (replace: boolean) => api.post<StudyStatus>(`/study/run${replace ? "?replace=true" : ""}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study-status"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const running = status.data?.state === "running";
  return { status: status.data, running, start: (replace = false) => start.mutate(replace) };
}

export function StudyProgress({ status }: { status: StudyStatus | undefined }) {
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

export function StudyCard({ compact = false }: { compact?: boolean }) {
  const { status, running, start } = useStudy();
  return (
    <div className={compact ? "space-y-3" : "flex flex-col items-center gap-4 px-6 py-10 text-center"}>
      {!compact && (
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Database className="size-6" />
        </div>
      )}
      {!compact && (
        <div>
          <div className="text-base font-semibold text-fg">Run the research study</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Runs the study's comparisons and backtests on the bundled market data (SPY, AAPL, RELIANCE, TCS, BTC) with every registered model, and saves them to Run History. Takes about a minute.
          </p>
        </div>
      )}
      {running ? (
        <div className="w-full max-w-sm">
          <StudyProgress status={status} />
        </div>
      ) : (
        <Button variant="primary" icon={<Play className="size-4" />} onClick={() => start(false)}>
          Run study
        </Button>
      )}
    </div>
  );
}
