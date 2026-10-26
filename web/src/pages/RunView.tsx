import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import type { RunPayload } from "../api/types";
import { BacktestResults } from "../components/BacktestResults";
import { CompareResults } from "../components/CompareResults";
import { Alert, PageHeader, Skeleton } from "../components/ui";
import { dateTimeLocal } from "../lib/format";

export default function RunView() {
  const { id } = useParams();
  const { data: run, isLoading, error } = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.get<RunPayload>(`/runs/${id}`),
    enabled: !!id,
  });

  return (
    <div className="space-y-4">
      <Link to="/runs" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Run History
      </Link>
      {isLoading && <Skeleton className="h-[600px]" />}
      {error && <Alert tone="error" title="Could not load run">{(error as Error).message}</Alert>}
      {run && (
        <>
          <PageHeader
            title={run.name ?? (run.kind === "compare" ? `Comparison · ${run.symbol}` : `${run.strategies[0]?.label} · ${run.symbol}`)}
            subtitle={`Saved ${dateTimeLocal(run.created_at)}${run.git_sha ? ` · code ${run.git_sha}` : ""} · run ${run.run_id?.slice(0, 8)}`}
          />
          {run.kind === "compare" ? <CompareResults key={run.run_id} run={run} /> : <BacktestResults key={run.run_id} run={run} />}
        </>
      )}
    </div>
  );
}
