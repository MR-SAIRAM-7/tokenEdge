import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, History, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useRuns } from "../api/queries";
import { DemoSeedCard } from "../components/DemoSeed";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Skeleton } from "../components/ui";
import { date, dateTimeLocal, num } from "../lib/format";

type Kind = "all" | "backtest" | "compare";
const PER_PAGE = 25;

export default function Runs() {
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useRuns({ kind: kind === "all" ? undefined : kind, limit: PER_PAGE, offset: page * PER_PAGE });
  const q = query.trim().toLowerCase();
  const items = (data?.items ?? []).filter((r) => !q || `${r.name ?? ""} ${r.symbol} ${r.strategies.join(" ")}`.toLowerCase().includes(q));

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/runs/${id}`),
    onSuccess: () => {
      toast("Run deleted.", "ok");
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/runs/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs"] }),
    onError: (e: Error) => toast(e.message, "error"),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<History className="size-5" />}
        eyebrow="Records"
        title="Run History"
        subtitle="Every backtest and comparison is stored with its full configuration, data hash and code version, so results can be reopened exactly."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented<Kind>
            value={kind}
            onChange={(k) => { setKind(k); setPage(0); }}
            size="sm"
            options={[
              { value: "all", label: "All" },
              { value: "backtest", label: "Backtests" },
              { value: "compare", label: "Comparisons" },
            ]}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
            <Input className="h-8 w-64 pl-8" placeholder="Search name, symbol or strategy" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {data && <span className="ml-auto text-xs text-muted">{data.total} runs</span>}
        </div>
        {isLoading && <Skeleton className="m-4 h-40" />}
        {error && <EmptyState title="Could not load runs">{(error as Error).message}</EmptyState>}
        {data && data.total === 0 && <DemoSeedCard />}
        {data && data.total > 0 && items.length === 0 && <EmptyState title="No runs match">Try a different search or filter.</EmptyState>}
        {data && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-2 py-2 font-medium">Name / strategies</th>
                  <th className="px-2 py-2 font-medium">Market</th>
                  <th className="px-2 py-2 font-medium">Window</th>
                  <th className="px-2 py-2 text-right font-medium">Best Sharpe</th>
                  <th className="px-2 py-2 font-medium">Sample</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const sharpes = Object.values(r.metrics).map((m) => m.sharpe as number | null).filter((x): x is number => x !== null);
                  return (
                    <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-panel-2/50">
                      <td className="px-4 py-2 whitespace-nowrap text-fg-2">{dateTimeLocal(r.created_at)}</td>
                      <td className="max-w-[340px] px-2 py-2">
                        <Link to={`/runs/${r.id}`} className="block truncate font-medium text-fg hover:text-accent">
                          {r.name ?? r.strategies.join(" vs ")}
                        </Link>
                        <span className="text-xs text-muted">
                          <Badge tone="neutral" className="mr-1">
                            {r.kind}
                          </Badge>
                          {r.name ? r.strategies.join(", ") : ""}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-fg-2">
                        {r.symbol} · {r.interval}
                      </td>
                      <td className="tabular px-2 py-2 whitespace-nowrap text-fg-2">
                        {date(r.start)} → {date(r.end)}
                      </td>
                      <td className="tabular px-2 py-2 text-right text-fg">{sharpes.length ? num(Math.max(...sharpes), 2) : "—"}</td>
                      <td className="px-2 py-2">{r.model_ids.length ? <Badge tone={r.in_sample ? "bad" : "ok"}>{r.in_sample ? "In-sample" : "Held-out"}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Rename"
                            icon={<Pencil className="size-3.5" />}
                            onClick={() => {
                              const name = window.prompt("Run name", r.name ?? "");
                              if (name !== null) rename.mutate({ id: r.id, name: name.trim() });
                            }}
                          />
                          <a href={api.url(`/runs/${r.id}/export`, { format: "csv" })} title="Export CSV">
                            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} />
                          </a>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Delete"
                            icon={<Trash2 className="size-3.5" />}
                            onClick={() => window.confirm("Delete this run permanently?") && del.mutate(r.id)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2 text-xs text-muted">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <span className="tabular">
              {page + 1} / {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
