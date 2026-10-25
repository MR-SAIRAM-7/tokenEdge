import clsx from "clsx";
import {
  BookOpen,
  BrainCircuit,
  CandlestickChart,
  FlaskConical,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Menu,
  Moon,
  Sun,
  WifiOff,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { useHealth } from "../api/queries";
import { useTheme } from "../state/theme";
import { MarketPicker } from "./MarketPicker";
import { Badge } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/data", label: "Data Explorer", icon: CandlestickChart },
  { to: "/backtest", label: "Backtest Lab", icon: FlaskConical },
  { to: "/compare", label: "Compare", icon: GitCompareArrows },
  { to: "/models", label: "Models", icon: BrainCircuit },
  { to: "/runs", label: "Run History", icon: History },
  { to: "/methodology", label: "Methodology", icon: BookOpen },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-panel-2" />
        <path d="M6 22l6-7 5 4 9-10" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="26" cy="9" r="2.5" fill="#d95926" />
      </svg>
      <div>
        <div className="text-[15px] leading-tight font-semibold tracking-tight text-fg">TokenEdge</div>
        <div className="text-[10.5px] leading-tight text-muted">Trading research platform</div>
      </div>
    </div>
  );
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { data: health } = useHealth();
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <Logo />
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-panel-2 hover:text-fg",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-2 px-2 text-[11px] text-muted">
        {health?.offline && (
          <Badge tone="warn">
            <WifiOff className="size-3" /> Offline mode
          </Badge>
        )}
        <div>
          v{health?.version ?? "…"}
          {health?.git_sha ? ` · ${health.git_sha}` : ""} · {health?.models ?? 0} model{health?.models === 1 ? "" : "s"}
        </div>
        <a className="hover:text-fg" href="/docs" target="_blank" rel="noreferrer">
          API docs ↗
        </a>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { mode, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-panel lg:block">
        <SideNav />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-panel">
            <button className="absolute top-4 right-3 text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <SideNav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur">
          <button className="text-fg-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <MarketPicker />
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggle}
              className="flex size-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-fg-2 hover:text-fg"
              aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={mode === "dark" ? "Light theme" : "Dark theme"}
            >
              {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="border-t border-line px-6 py-3 text-center text-[11px] text-muted">
          TokenEdge is for education and research only. It simulates trades on historical data, places no orders and is not financial advice.
        </footer>
      </div>
    </div>
  );
}
