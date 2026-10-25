import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ThemeProvider } from "./state/theme";
import { MarketProvider } from "./state/market";
import { ToastProvider } from "./components/Toast";
import { UiProvider } from "./state/ui";
import "@fontsource-variable/inter";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MarketProvider>
          <ToastProvider>
            <BrowserRouter>
              <UiProvider>
                <App />
              </UiProvider>
            </BrowserRouter>
          </ToastProvider>
        </MarketProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
