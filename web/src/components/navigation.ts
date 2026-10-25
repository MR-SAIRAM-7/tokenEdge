import {
  BookOpen,
  BrainCircuit,
  CandlestickChart,
  FlaskConical,
  GitCompareArrows,
  GraduationCap,
  History,
  LayoutDashboard,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  description: string;
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, description: "Summary, markets and latest results" },
      { to: "/findings", label: "Findings", icon: Trophy, description: "Scoreboard across all markets" },
      { to: "/project", label: "About the project", icon: GraduationCap, description: "Abstract, objectives, architecture, team" },
    ],
  },
  {
    title: "Research",
    items: [
      { to: "/compare", label: "Compare", icon: GitCompareArrows, description: "Classical vs ML on held-out data" },
      { to: "/backtest", label: "Backtest Lab", icon: FlaskConical, description: "Run one strategy with realistic costs" },
    ],
  },
  {
    title: "Data & models",
    items: [
      { to: "/data", label: "Data Explorer", icon: CandlestickChart, description: "Prices, indicators, data quality" },
      { to: "/models", label: "Models", icon: BrainCircuit, description: "Trained XGBoost and LSTM models" },
    ],
  },
  {
    title: "Records",
    items: [
      { to: "/runs", label: "Run History", icon: History, description: "Every saved backtest and comparison" },
      { to: "/methodology", label: "Methodology", icon: BookOpen, description: "How look-ahead bias is prevented" },
    ],
  },
];
