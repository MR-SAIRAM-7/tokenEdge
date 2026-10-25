import clsx from "clsx";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  tone: "info" | "error" | "ok";
  message: string;
}

const Ctx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 4000);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex items-start gap-2 rounded-lg border bg-panel px-3 py-2.5 text-sm text-fg shadow-xl",
              t.tone === "error" ? "border-neg/50" : t.tone === "ok" ? "border-pos/50" : "border-line",
            )}
          >
            <span className={clsx("mt-1.5 size-2 shrink-0 rounded-full", t.tone === "error" ? "bg-neg" : t.tone === "ok" ? "bg-pos" : "bg-accent")} />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button className="text-muted hover:text-fg" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
