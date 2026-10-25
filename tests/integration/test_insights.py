from tokenedge import study
from tokenedge.api.routes import insights
from tokenedge.config import Instrument


def test_study_runs_real_comparisons(client, monkeypatch):
    monkeypatch.setattr(study, "STUDY_MARKETS", [("SYN", "yfinance", "1d")])
    status = study.run_study()
    assert status["state"] == "done"
    assert status["done"] == status["total"] > 0
    # Scenarios for markets without data fail individually without stopping the study.
    assert all("SYN" not in e for e in status["errors"])

    runs = client.get("/api/runs", params={"symbol": "SYN", "kind": "compare", "limit": 50}).json()[
        "items"
    ]
    study_runs = [r for r in runs if r["name"] == "SYN: classical vs ML on held-out data"]
    assert study_runs and set(study_runs[0]["model_ids"]) == {
        "xgb_syn_1d_fh_v1",
        "lstm_syn_1d_fh_v1",
    }
    assert study_runs[0]["in_sample"] is False

    again = study.run_study(replace=True)
    assert again["state"] == "done"
    runs = client.get("/api/runs", params={"symbol": "SYN", "kind": "compare", "limit": 50}).json()[
        "items"
    ]
    assert len([r for r in runs if r["name"] == "SYN: classical vs ML on held-out data"]) == 1

    s = client.get("/api/study/status").json()
    assert s["state"] == "done" and s["has_runs"] is True


def test_findings_uses_latest_comparison_per_market(client):
    body = {
        "symbol": "SYN",
        "strategies": [
            {"name": "buy_hold"},
            {"name": "sma_crossover", "params": {"fast": 10, "slow": 50}},
        ],
        "statistics": {"bootstrap_samples": 200},
        "cost_levels": [],
        "name": "latest",
    }
    client.post("/api/compare", json=body)
    items = client.get("/api/findings").json()["items"]
    syn = [f for f in items if f["symbol"] == "SYN"]
    assert len(syn) == 1 and syn[0]["name"] == "latest"
    f = syn[0]
    assert set(f["metrics"]) == {"buy_hold", "sma_crossover"}
    assert {"sharpe", "max_drawdown", "psr"} <= set(f["metrics"]["sma_crossover"])
    assert f["ranking"] and f["verdict"]


def test_markets_overview(client, monkeypatch):
    monkeypatch.setattr(
        insights,
        "DEFAULT_UNIVERSE",
        (
            Instrument("SYN", "yfinance", "1d", "Synthetic"),
            Instrument("NOPE", "yfinance", "1d", "Missing"),
        ),
    )
    items = client.get("/api/markets/overview").json()["items"]
    assert [i["symbol"] for i in items] == ["SYN"]
    syn = items[0]
    assert syn["last_close"] > 0 and len(syn["sparkline"]) >= 30
    assert syn["change_1y"] is not None and syn["volatility_1y"] > 0
