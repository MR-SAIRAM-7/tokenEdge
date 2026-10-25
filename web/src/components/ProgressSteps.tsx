import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "./ui";

/**
 * Shown while a long request runs. The server does the work in one call, so the steps advance
 * on a timer to show what is happening; the last step stays active until the response arrives.
 */
export function ProgressSteps({ title, steps, intervalMs = 900 }: { title: string; steps: string[]; intervalMs?: number }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => Math.min(a + 1, steps.length - 1)), intervalMs);
    return () => clearInterval(id);
  }, [steps.length, intervalMs]);

  return (
    <Card className="animate-in overflow-hidden">
      <div className="relative h-1 overflow-hidden bg-panel-2">
        <div className="progress-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-accent" />
      </div>
      <div className="p-6">
        <div className="text-sm font-semibold text-fg">{title}</div>
        <ol className="mt-4 space-y-2.5">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2.5 text-sm">
              {i < active ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-ok-soft text-pos">
                  <Check className="size-3.5" />
                </span>
              ) : i === active ? (
                <Loader2 className="size-5 animate-spin text-accent" />
              ) : (
                <span className="size-5 rounded-full border border-line" />
              )}
              <span className={i <= active ? "text-fg" : "text-muted"}>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
