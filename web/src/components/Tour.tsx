import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useUi } from "../state/ui";
import { Button } from "./ui";

interface Step {
  title: string;
  body: string;
  route?: string;
  target?: string;
  placement?: "bottom" | "right" | "top";
}

const STEPS: Step[] = [
  {
    title: "Welcome to TokenEdge",
    body: "TokenEdge answers one research question: after realistic costs, on data the models have never seen, does machine learning beat a simple moving-average rule? This 2-minute tour shows where everything is.",
  },
  {
    title: "Pick a market",
    body: "Every page follows this selector. Nine markets are bundled (US and Indian equities, Bitcoin, Ether, Solana), so the app works offline. You can also type any Yahoo ticker or crypto pair.",
    route: "/",
    target: '[data-tour="market"]',
  },
  {
    title: "Navigation",
    body: "Overview pages summarise results, Research pages run experiments, and Data & models shows the inputs. Ctrl+K opens a quick search for pages, markets and actions.",
    route: "/",
    target: '[data-tour="nav"]',
    placement: "right",
  },
  {
    title: "Data Explorer",
    body: "Candlesticks with moving averages, Bollinger Bands, RSI and MACD, plus a data-quality report. The data hash identifies the exact bars behind every result.",
    route: "/data",
    target: '[data-tour="price-chart"]',
  },
  {
    title: "Backtest Lab",
    body: "Run one strategy with commissions and slippage. Signals from bar t fill at the next bar's open, so a strategy can never trade on information it does not have yet. Quick scenarios fill everything in one click.",
    route: "/backtest",
    target: '[data-tour="backtest-config"]',
    placement: "right",
  },
  {
    title: "Compare strategies",
    body: "Buy & Hold, the SMA baseline, XGBoost and LSTM run on the same held-out window with the same costs. The report adds a bootstrap significance test, the Deflated Sharpe Ratio and cost sensitivity.",
    route: "/compare",
    target: '[data-tour="compare-setup"]',
    placement: "right",
  },
  {
    title: "Findings",
    body: "The scoreboard collects the latest comparison for every market: which strategy had the best risk-adjusted return, and whether the difference is statistically significant.",
    route: "/findings",
    target: '[data-tour="scoreboard"]',
  },
  {
    title: "Models",
    body: "XGBoost and LSTM models are trained in the cloud, never inside the app. Each card shows the training, validation and held-out windows. Backtests on training data are blocked by default.",
    route: "/models",
    target: '[data-tour="models"]',
  },
  {
    title: "Methodology",
    body: "How look-ahead bias is prevented: chronological splits with purging and embargo, causal features verified by tests, validation-only tuning, and a locked test set.",
    route: "/methodology",
    target: '[data-tour="methodology"]',
  },
  {
    title: "You're ready",
    body: "Tip for the review: press Shift+P for presentation mode (bigger text for projectors) and use Run History to reopen any saved result exactly as it was.",
  },
];

const PAD = 6;
const CARD_W = 340;

export function Tour() {
  const { tourStep, setTourStep } = useUi();
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = tourStep !== null ? STEPS[tourStep] : null;

  useEffect(() => {
    if (step?.route && location.pathname !== step.route) navigate(step.route);
  }, [step, location.pathname, navigate]);

  // Find the target once its page has rendered, then keep the spotlight aligned.
  useLayoutEffect(() => {
    setRect(null);
    if (!step?.target) return;
    let el: Element | null = null;
    let tries = 0;
    const update = () => el && setRect(el.getBoundingClientRect());
    const find = setInterval(() => {
      // Ignore matches that are hidden at this screen size (e.g. the sidebar on small screens).
      el = Array.from(document.querySelectorAll(step.target!)).find((e) => e.getBoundingClientRect().width > 0) ?? null;
      tries += 1;
      if (el || tries > 40) {
        clearInterval(find);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          setTimeout(update, 350);
        }
      }
    }, 100);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearInterval(find);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step, location.pathname]);

  useEffect(() => {
    if (tourStep === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTourStep(null);
      if (e.key === "ArrowRight") setTourStep(Math.min(tourStep + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setTourStep(Math.max(tourStep - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourStep, setTourStep]);

  if (tourStep === null || !step) return null;
  const last = tourStep === STEPS.length - 1;

  let cardStyle: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (step.placement === "right" && rect.right + CARD_W + 24 < vw) {
      cardStyle = { left: rect.right + 16, top: Math.min(Math.max(16, rect.top), vh - 280) };
    } else {
      const below = rect.bottom + 16;
      const top = below + 240 < vh ? below : Math.max(16, rect.top - 256);
      cardStyle = { left: Math.min(Math.max(16, rect.left), vw - CARD_W - 16), top };
    }
  }

  return (
    <div className="fixed inset-0 z-[95]" aria-live="polite">
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent transition-all duration-300"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(5, 8, 12, 0.6)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(5,8,12,0.6)]" />
      )}
      <div className="animate-in fixed rounded-2xl border border-line bg-panel p-5 shadow-pop" style={{ ...cardStyle, width: CARD_W }} role="dialog" aria-label={step.title}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-wider text-accent uppercase">
            Step {tourStep + 1} of {STEPS.length}
          </div>
          <button className="text-muted hover:text-fg" onClick={() => setTourStep(null)} aria-label="Close tour">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-1.5 text-base font-semibold text-fg">{step.title}</div>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === tourStep ? "w-4 bg-accent" : "w-1.5 bg-line"}`} />
            ))}
          </div>
          <div className="flex gap-1.5">
            {tourStep > 0 && (
              <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => setTourStep(tourStep - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => setTourStep(last ? null : tourStep + 1)}>
              {last ? "Finish" : "Next"} {!last && <ArrowRight className="size-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
