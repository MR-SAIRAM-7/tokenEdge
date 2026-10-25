import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { load, save } from "../lib/storage";

interface UiCtx {
  present: boolean;
  togglePresent: () => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  tourStep: number | null;
  startTour: () => void;
  setTourStep: (step: number | null) => void;
}

const Ctx = createContext<UiCtx>(null as unknown as UiCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [present, setPresent] = useState(false);
  const [collapsed, setCollapsed] = useState(() => load<boolean>("tokenedge.sidebarCollapsed", false));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("present", present);
  }, [present]);
  useEffect(() => save("tokenedge.sidebarCollapsed", collapsed), [collapsed]);

  // Global shortcuts: Ctrl/Cmd+K opens the command palette, Shift+P toggles presentation mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (!typing && e.shiftKey && e.key.toLowerCase() === "p") {
        setPresent((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startTour = useCallback(() => {
    setPaletteOpen(false);
    setTourStep(0);
    save("tokenedge.tourSeen", true);
  }, []);

  return (
    <Ctx.Provider
      value={{
        present,
        togglePresent: () => setPresent((p) => !p),
        collapsed: collapsed || present,
        toggleCollapsed: () => setCollapsed((c) => !c),
        paletteOpen,
        setPaletteOpen,
        tourStep,
        startTour,
        setTourStep,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useUi = () => useContext(Ctx);
