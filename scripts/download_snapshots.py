"""Download the default universe into data/snapshots/ (bundled data for offline use).

Usage:
    python scripts/download_snapshots.py               # all default instruments
    python scripts/download_snapshots.py SPY BTC/USDT  # a subset
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tokenedge.config import DEFAULT_UNIVERSE, HISTORY_START, get_settings  # noqa: E402
from tokenedge.data.cache import snapshot_file, write_parquet  # noqa: E402
from tokenedge.data.loader import download  # noqa: E402
from tokenedge.data.quality import quality_report  # noqa: E402


def main(symbols: list[str]) -> int:
    settings = get_settings()
    failures = 0
    for inst in DEFAULT_UNIVERSE:
        if symbols and inst.symbol not in symbols:
            continue
        print(f"-> {inst.symbol:<14} {inst.source:<9} {inst.interval}", end=" ", flush=True)
        try:
            df = download(
                inst.symbol, inst.source, inst.interval, HISTORY_START[inst.asset_class], settings
            )
        except Exception as exc:
            failures += 1
            print(f"FAILED: {exc}")
            continue
        if df.empty:
            failures += 1
            print("FAILED: no data")
            continue
        path = snapshot_file(settings.snapshot_dir, inst.symbol, inst.interval)
        write_parquet(df, path)
        q = quality_report(df, inst.interval, inst.asset_class)
        print(
            f"{len(df):>6} bars  {df.index[0].date()} -> {df.index[-1].date()}  "
            f"{path.stat().st_size / 1e6:.2f} MB  issues={len(q['issues'])}"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
