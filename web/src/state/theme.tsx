import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Mode } from "../lib/colors";

const KEY = "tokenedge.theme"; // raw string, also read by the inline script in index.html

interface ThemeCtx {
  mode: Mode;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx>({ mode: "dark", toggle: () => {} });

function initialMode(): Mode {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.dataset.theme = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* preference just won't persist */
    }
  }, [mode]);

  return <Ctx.Provider value={{ mode, toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")) }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
