import math

import numpy as np
import pandas as pd
import pytest

from tokenedge.engine import ExecutionConfig, run_backtest
from tokenedge.metrics import (
    bootstrap_sharpe_difference,
    compare_strategies,
    compute_metrics,
    cost_sensitivity,
    deflated_sharpe_ratio,
    probabilistic_sharpe_ratio,
    sharpe_ratio,
)
from tokenedge.metrics.report import _break_even
from tokenedge.strategies import get_strategy


def test_sharpe_matches_formula():
    r = pd.Series([0.01, -0.005, 0.007, 0.002, -0.003, 0.004])
    expected = (r - 0.02 / 252).mean() / r.std(ddof=1) * math.sqrt(252)
    assert sharpe_ratio(r, 252, 0.02) == pytest.approx(expected)


def test_drawdown_and_metric_keys(daily):
    res = run_backtest(
        daily,
        pd.Series(1.0, index=daily.index),
        daily.index[0],
        daily.index[500],
        ExecutionConfig(),
    )
    m = compute_metrics(res)
    eq = res.equity
    expected_mdd = (eq / eq.cummax().clip(lower=100_000) - 1).min()
    assert m["max_drawdown"] == pytest.approx(expected_mdd)
    for key in (
        "total_return",
        "cagr",
        "sharpe",
        "sortino",
        "calmar",
        "psr",
        "trades",
        "exposure",
        "turnover",
    ):
        assert key in m
    assert 0 <= m["psr"] <= 1


def test_psr_increases_with_mean_and_dsr_penalizes_trials():
    rng = np.random.default_rng(0)
    noise = rng.normal(0, 0.01, 1000)
    low, high = noise + 0.0002, noise + 0.001
    assert probabilistic_sharpe_ratio(high) > probabilistic_sharpe_ratio(low)
    one = deflated_sharpe_ratio(high, 1, 252)
    many = deflated_sharpe_ratio(high, 100, 252, trial_sharpe_std_annual=0.5)
    assert one["dsr"] == pytest.approx(probabilistic_sharpe_ratio(high))
    assert many["dsr"] < one["dsr"]
    assert many["sr0_annual"] > 0


def test_bootstrap_detects_difference_and_identity():
    rng = np.random.default_rng(1)
    a = rng.normal(0.002, 0.01, 1500)
    same = bootstrap_sharpe_difference(a, a, 252, n_samples=500)
    assert same["estimate"] == pytest.approx(0)
    assert same["ci_low"] <= 0 <= same["ci_high"]
    b = rng.normal(-0.001, 0.01, 1500)
    diff = bootstrap_sharpe_difference(a, b, 252, n_samples=2000)
    assert diff["significant"] and diff["ci_low"] > 0 and diff["p_value"] < 0.05
    assert sum(diff["histogram"]["counts"]) == 2000


def test_bootstrap_of_nearly_flat_strategy_stays_finite():
    """A strategy flat on almost every bar: resamples that miss its few trades are constant,
    and their Sharpe must count as zero rather than blow up from rounding noise."""
    rng = np.random.default_rng(3)
    active = rng.normal(0.0005, 0.01, 20_000)
    flat = np.zeros(20_000)
    flat[[500, 9_000, 15_000]] = [0.01, -0.02, 0.005]
    res = bootstrap_sharpe_difference(flat, active, 8760, n_samples=2000, rf_annual=0.04)
    assert np.isfinite([res["ci_low"], res["ci_high"]]).all()
    assert -100 < res["ci_low"] <= res["ci_high"] < 100
    assert max(abs(e) for e in res["histogram"]["edges"]) < 100


def test_compare_and_cost_sensitivity(daily):
    cfg = ExecutionConfig(commission={"buy_bps": 5, "sell_bps": 5})
    sigs = {
        "buy_hold": get_strategy("buy_hold").generate_signals(daily),
        "sma_crossover": get_strategy("sma_crossover", {"fast": 10, "slow": 50}).generate_signals(
            daily
        ),
    }
    results = {k: run_backtest(daily, s, "2016-01-01", None, cfg, 252, k) for k, s in sigs.items()}
    rep = compare_strategies(
        results, baseline="sma_crossover", trials={"sma_crossover": 20}, bootstrap_samples=300
    )
    assert set(rep["metrics"]) == {"buy_hold", "sma_crossover"}
    assert rep["sharpe_diff"]["buy_hold"] is not None
    assert rep["dsr"]["sma_crossover"]["n_trials"] == 20
    assert "Sharpe" in rep["verdict"]
    sens = cost_sensitivity(daily, sigs, "2016-01-01", None, cfg, 252, (0.0, 10.0, 50.0))
    sma = sens["strategies"]["sma_crossover"]["total_return"]
    assert sma[0] > sma[1] > sma[2]


def test_break_even_interpolation():
    assert _break_even([0, 10, 20], [0.2, 0.1, -0.1]) == pytest.approx(15.0)
    assert _break_even([0, 10], [-0.1, -0.2]) == 0.0
    assert _break_even([0, 10], [0.3, 0.2]) is None


def test_flat_equity_has_zero_sharpe_not_noise(daily):
    """No trades -> constant returns; float noise must not produce a huge Sharpe ratio."""
    res = run_backtest(
        daily, pd.Series(0.0, index=daily.index), daily.index[0], None, ExecutionConfig()
    )
    m = compute_metrics(res, rf_annual=0.04)
    assert m["sharpe"] == 0.0
    assert m["psr"] is None
    assert sharpe_ratio(pd.Series(np.full(500, 0.0)), 252, 0.037) == 0.0


def test_bootstrap_estimate_matches_reported_sharpe_difference(daily):
    cfg = ExecutionConfig()
    a = run_backtest(daily, pd.Series(1.0, index=daily.index), "2016-01-01", None, cfg)
    sig = get_strategy("sma_crossover", {"fast": 10, "slow": 50}).generate_signals(daily)
    b = run_backtest(daily, sig, "2016-01-01", None, cfg)
    rep = compare_strategies(
        {"buy_hold": a, "sma_crossover": b},
        baseline="sma_crossover",
        rf_annual=0.04,
        bootstrap_samples=200,
    )
    m = rep["metrics"]
    assert rep["sharpe_diff"]["buy_hold"]["estimate"] == pytest.approx(
        m["buy_hold"]["sharpe"] - m["sma_crossover"]["sharpe"], abs=1e-9
    )
