import io
import zipfile

SYN = {"symbol": "SYN", "source": "yfinance", "interval": "1d"}


def test_meta_endpoints(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["offline"] is True and h["models"] == 2
    names = {s["name"] for s in client.get("/api/strategies").json()["items"]}
    assert names == {"buy_hold", "sma_crossover", "xgboost", "lstm"}
    assert len(client.get("/api/cost-presets").json()["items"]) == 4
    assert "equity" in client.get("/api/splits").json()
    assert client.get("/api/symbols").json()["offline"] is True


def test_data_endpoints(client):
    o = client.get("/api/data/ohlcv", params={**SYN, "limit": 100}).json()
    assert o["bars"] == 100 and len(o["close"]) == 100 and o["data_hash"].startswith("sha256:")
    q = client.get("/api/data/quality", params=SYN).json()
    assert q["bars"] > 3000
    ind = client.get(
        "/api/data/indicators", params={**SYN, "limit": 50, "indicators": "sma:20,bb,rsi:14,macd"}
    ).json()
    assert {"sma_20", "bb_upper", "rsi_14", "macd_hist"} <= set(ind["series"])
    assert all(v is not None for v in ind["series"]["sma_20"])  # warmed up on full history
    bad = client.get("/api/data/indicators", params={**SYN, "indicators": "foo"})
    assert bad.status_code == 422
    missing = client.get("/api/data/ohlcv", params={"symbol": "NOPE"})
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "DATA_UNAVAILABLE"


def test_backtest_sma(client):
    r = client.post(
        "/api/backtest",
        json={**SYN, "strategy": {"name": "sma_crossover", "params": {"fast": 10, "slow": 50}}},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    n = len(j["series"]["timestamp"])
    assert n > 500 and len(j["series"]["equity"]) == n == len(j["series"]["benchmark_equity"])
    assert j["window"]["start"].startswith("2023-01-0")
    assert j["metrics"]["trades"] == len(j["trades"]) and j["benchmark_metrics"]["trades"] == 1
    assert j["execution"]["preset"] == "us_equity" and j["run_id"]
    assert j["held_out_start"] is None and j["in_sample"] is False


def test_ml_window_guard_and_in_sample_flag(client):
    body = {
        **SYN,
        "window": "val",
        "strategy": {"name": "xgboost", "params": {"model_id": "xgb_syn_1d_fh_v1"}},
    }
    r = client.post("/api/backtest", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "IN_SAMPLE_WINDOW"
    r = client.post("/api/backtest", json={**body, "allow_in_sample": True})
    assert r.status_code == 200 and r.json()["in_sample"] is True
    ok = client.post("/api/backtest", json={**body, "window": "model_test"}).json()
    assert ok["in_sample"] is False and ok["diagnostics"]["n"] > 100
    assert "proba" in ok["series"]


def test_compare_counts_test_evaluations(client):
    before = {
        m["model_id"]: m["test_evaluations"] for m in client.get("/api/models").json()["items"]
    }
    body = {
        **SYN,
        "strategies": [
            {"name": "buy_hold"},
            {"name": "sma_crossover", "params": {"fast": 10, "slow": 50}, "trials": 20},
            {"name": "xgboost", "params": {"model_id": "xgb_syn_1d_fh_v1"}},
            {"name": "lstm", "params": {"model_id": "lstm_syn_1d_fh_v1"}},
        ],
        "statistics": {"bootstrap_samples": 300},
        "cost_levels": [0, 10, 25],
    }
    r = client.post("/api/compare", json=body)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["baseline"] == "sma_crossover" and set(j["sharpe_diff"]) == {
        "buy_hold",
        "xgboost",
        "lstm",
    }
    assert j["dsr"]["sma_crossover"]["n_trials"] == 20 and j["dsr"]["xgboost"]["n_trials"] == 10
    assert j["sensitivity"]["levels"] == [0, 10, 25] and j["verdict"]
    assert set(j["diagnostics"]) == {"xgboost", "lstm"}
    after = {
        m["model_id"]: m["test_evaluations"] for m in client.get("/api/models").json()["items"]
    }
    assert after["xgb_syn_1d_fh_v1"] == before["xgb_syn_1d_fh_v1"] + 1
    detail = client.get("/api/models/xgb_syn_1d_fh_v1").json()
    assert "model.json" in detail["files"]


def test_sensitivity_and_tune(client):
    s = client.post(
        "/api/sensitivity",
        json={**SYN, "strategies": [{"name": "sma_crossover"}], "cost_levels": [0, 20]},
    ).json()
    assert len(s["strategies"]["sma_crossover"]["sharpe"]) == 2
    t = client.post(
        "/api/tune/sma", json={**SYN, "fast_grid": [5, 10], "slow_grid": [50, 100]}
    ).json()
    assert t["trials"] == 4 and t["best"]["fast"] in (5, 10)


def test_validation_errors_are_readable(client):
    r = client.post(
        "/api/backtest",
        json={**SYN, "strategy": {"name": "sma_crossover", "params": {"fast": 60, "slow": 20}}},
    )
    assert r.status_code == 422 and "fast window must be smaller" in r.json()["error"]["message"]
    r = client.post(
        "/api/backtest", json={**SYN, "interval": "bad", "strategy": {"name": "buy_hold"}}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    r = client.post("/api/backtest", json={**SYN, "strategy": {"name": "magic"}})
    assert r.status_code == 422


def test_run_history_crud_and_export(client):
    r = client.post(
        "/api/backtest", json={**SYN, "name": "keep me", "strategy": {"name": "buy_hold"}}
    ).json()
    run_id = r["run_id"]
    listing = client.get("/api/runs", params={"symbol": "SYN", "kind": "backtest"}).json()
    assert any(item["id"] == run_id for item in listing["items"])
    stored = client.get(f"/api/runs/{run_id}").json()
    assert stored["metrics"] == r["metrics"] and stored["name"] == "keep me"
    assert client.patch(f"/api/runs/{run_id}", json={"name": "renamed"}).status_code == 200
    zbytes = client.get(f"/api/runs/{run_id}/export", params={"format": "csv"}).content
    names = set(zipfile.ZipFile(io.BytesIO(zbytes)).namelist())
    assert names == {"metrics.csv", "equity.csv", "trades.csv", "run.json"}
    assert (
        client.get(f"/api/runs/{run_id}/export", params={"format": "json"}).json()["run_id"]
        == run_id
    )
    assert client.delete(f"/api/runs/{run_id}").status_code == 200
    assert client.get(f"/api/runs/{run_id}").status_code == 404


def test_reproducible_results(client):
    body = {
        **SYN,
        "strategy": {"name": "sma_crossover", "params": {"fast": 20, "slow": 100}},
        "save": False,
    }
    a, b = (
        client.post("/api/backtest", json=body).json(),
        client.post("/api/backtest", json=body).json(),
    )
    assert a["metrics"] == b["metrics"] and a["data_hash"] == b["data_hash"]
