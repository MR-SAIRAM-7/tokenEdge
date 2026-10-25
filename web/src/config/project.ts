// Project details shown on the "About the project" page.
// Edit the team, guide and college fields before the review.

export const PROJECT = {
  name: "TokenEdge",
  title: "AI-Powered Algorithmic Trading Research Platform",
  course: "Major Project · B.Tech 4th Year",
  college: "", // e.g. "ABC Institute of Technology"
  department: "Department of Computer Science and Engineering",
  academicYear: "2026–27",
  team: [
    // { name: "Full name", roll: "Roll number" },
  ] as { name: string; roll?: string }[],
  guide: { name: "", designation: "" }, // e.g. { name: "Dr. X", designation: "Associate Professor" }
  repo: "https://github.com/MR-SAIRAM-7/tokenEdge",
};

export const ABSTRACT =
  "A backtesting and signal-generation platform that implements and compares a classical technical-indicator strategy against " +
  "ML-based (XGBoost and LSTM) price-movement predictors on historical equity and crypto data, with strict train/test separation " +
  "to avoid look-ahead bias. Strategies are judged on held-out data by risk-adjusted returns after realistic transaction costs and slippage.";
