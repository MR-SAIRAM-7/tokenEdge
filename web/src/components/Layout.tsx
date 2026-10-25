import clsx from "clsx";
import { Command, Compass, Menu, Moon, PanelLeftClose, PanelLeftOpen, Presentation, Sun, WifiOff, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { useDemoStatus, useHealth } from "../api/queries";
import { useTheme } from "../state/theme";
import { useUi } from "../state/ui";
import { CommandPalette } from "./CommandPalette";
import { MarketPicker } from "./MarketPicker";
import { NAV_GROUPS } from "./navigation";
import { Tour } from "./Tour";

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="te-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--violet)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#te-logo)" />
        <path d="M7 21.5l5.5-6.5 4.5 3.5L25 10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="25" cy="10" r="2.2" fill="#fff" />
      </svg>
      {!compact && (
        <div className="min-w-0">
          <div className="text-[15px] leading-tight font-semibold tracking-tight text-fg">TokenEdge</div>
          <div className="truncate text-[11px] leading-tight text-muted">Trading research platform</div>
        </div>
      )}
    </div>
  );
}

function SideNav({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const { data: health } = useHealth();
  return (
    <div className="flex h-full flex-col gap-5 px-3 py-4">
      <Logo compact={compact} />
      <nav className="flex flex-col gap-4" data-tour="nav">
        {NAV_GROUPS.map((g) => (
          <div key={g.title}>
            {!compact && <div className="mb-1 px-2.5 text-[10.5px] font-semibold tracking-wider text-muted uppercase">{g.title}</div>}
            <div className="flex flex-col gap-0.5">
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={compact ? label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      "group relative flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors",
                      compact ? "justify-center px-0" : "px-2.5",
                      isActive ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-panel-2 hover:text-fg",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-accent" />}
                      <Icon className="size-4 shrink-0" />
                      {!compact && label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      {!compact && (
        <div className="mt-auto space-y-2 rounded-xl border border-line bg-panel-2 p-3 text-[11px] text-muted">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className={clsx("size-1.5 rounded-full", health ? "bg-pos" : "bg-muted")} />
              {health ? (health.offline ? "Offline mode" : "Online") : "Connecting…"}
            </span>
            <span className="tabular">v{health?.version ?? "…"}</span>
          </div>
          <div>
            {health?.models ?? 0} model{health?.models === 1 ? "" : "s"} registered{health?.git_sha ? ` · ${health.git_sha}` : ""}
          </div>
          <a className="block text-accent hover:underline" href="/docs" target="_blank" rel="noreferrer">
            REST API docs ↗
          </a>
        </div>
      )}
    </div>
  );
}

function IconButton({ onClick, label, active, children }: { onClick: () => void; label: string; active?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "flex size-9 items-center justify-center rounded-lg border transition-colors",
        active ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-panel text-fg-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { mode, toggle } = useTheme();
  const ui = useUi();
  const location = useLocation();
  const { data: health } = useHealth();
  const { data: demo } = useDemoStatus();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-full">
      <aside className={clsx("sticky top-0 hidden h-screen shrink-0 border-r border-line bg-panel transition-[width] duration-200 lg:block", ui.collapsed ? "w-[68px]" : "w-64")}>
        <SideNav compact={ui.collapsed} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="animate-in absolute inset-y-0 left-0 w-72 border-r border-line bg-panel">
            <button className="absolute top-5 right-3 text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            <SideNav compact={false} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-md">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
            <button className="text-fg-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <button className="hidden text-muted hover:text-fg lg:block" onClick={ui.toggleCollapsed} aria-label={ui.collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {ui.collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
            </button>
            <MarketPicker />
            <button
              onClick={() => ui.setPaletteOpen(true)}
              className="ml-1 hidden h-9 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-muted transition-colors hover:text-fg md:flex"
            >
              <Command className="size-3.5" /> Search
              <kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              {health?.offline && (
                <span className="hidden items-center gap-1 rounded-md bg-warn-soft px-2 py-1 text-[11px] font-medium text-warn sm:flex">
                  <WifiOff className="size-3" /> Offline
                </span>
              )}
              <button
                onClick={ui.startTour}
                className="hidden h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-sm text-fg-2 transition-colors hover:text-fg sm:flex"
              >
                <Compass className="size-4" /> Tour
              </button>
              <IconButton onClick={ui.togglePresent} label="Presentation mode (Shift+P)" active={ui.present}>
                <Presentation className="size-4" />
              </IconButton>
              <IconButton onClick={toggle} label={mode === "dark" ? "Light theme" : "Dark theme"}>
                {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </IconButton>
            </div>
          </div>
          {demo?.state === "running" && (
            <div className="relative h-0.5 overflow-hidden bg-panel-2" title="Loading demo data">
              <div className="h-full bg-accent transition-all duration-500" style={{ width: `${demo.total ? (demo.done / demo.total) * 100 : 5}%` }} />
            </div>
          )}
        </header>
        <main key={location.pathname} className="animate-in mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
        {!ui.present && (
          <footer className="border-t border-line px-6 py-4 text-center text-[11px] text-muted">
            TokenEdge is an educational research tool. It simulates trades on historical data, places no orders and is not financial advice.
          </footer>
        )}
      </div>
      <CommandPalette />
      <Tour />
    </div>
  );
}
