import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { EmptyState, Spinner } from "./components/ui";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const DataExplorer = lazy(() => import("./pages/DataExplorer"));
const BacktestLab = lazy(() => import("./pages/BacktestLab"));
const Compare = lazy(() => import("./pages/Compare"));
const Models = lazy(() => import("./pages/Models"));
const ModelDetailPage = lazy(() => import("./pages/ModelDetail"));
const Runs = lazy(() => import("./pages/Runs"));
const RunView = lazy(() => import("./pages/RunView"));
const Methodology = lazy(() => import("./pages/Methodology"));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<Spinner label="Loading…" />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/data" element={<DataExplorer />} />
          <Route path="/backtest" element={<BacktestLab />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/models" element={<Models />} />
          <Route path="/models/:id" element={<ModelDetailPage />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunView />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="*" element={<EmptyState title="Page not found">That page does not exist.</EmptyState>} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
