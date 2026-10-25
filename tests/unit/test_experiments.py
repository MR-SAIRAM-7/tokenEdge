from tokenedge.experiments import (
    e1_main_comparison,
    e2_cost_sensitivity,
    e4_lookahead_bias,
    e6_accuracy_vs_profit,
    e7_extensions,
)


def test_e1_e2_e6_with_registered_models(sandbox):
    e1, runs = e1_main_comparison([("SYN", "yfinance", "1d")], bootstrap_samples=200)
    assert set(e1["strategy"]) == {"buy_hold", "sma_crossover", "xgboost", "lstm"}
    assert e1["window"].iloc[0].startswith("2023-01-0")
    assert e1.loc[e1.strategy == "sma_crossover", "trials"].iloc[0] > 1
    e2 = e2_cost_sensitivity(runs, levels=(0, 25))
    assert len(e2) == 4 * 2
    e6 = e6_accuracy_vs_profit(runs)
    assert set(e6["model"]) == {"xgboost", "lstm"} and e6["accuracy"].between(0, 1).all()
    e7 = e7_extensions(runs).set_index("variant")
    expected = {"sma_crossover", "xgboost_all_in", "xgboost_sized", "sma_xgboost_filter"}
    assert expected | {"lstm_all_in", "lstm_sized", "sma_lstm_filter"} == set(e7.index)
    # The all-in rows reuse E1's backtests; the filter never trades more than the SMA it filters.
    sharpe = e1.set_index("strategy")["sharpe"]
    assert e7.loc["xgboost_all_in", "sharpe"] == sharpe["xgboost"]
    assert e7.loc["sma_xgboost_filter", "exposure"] <= e7.loc["sma_crossover", "exposure"]
    assert e7.loc["xgboost_sized", "exposure"] <= e7.loc["xgboost_all_in", "exposure"] + 1e-9


def test_e4_shows_leaks_inflate_results(sandbox):
    e4 = e4_lookahead_bias("SYN", "yfinance", "1d").set_index("variant")
    assert e4.loc["leak_peek_one_bar", "sharpe"] > e4.loc["clean", "sharpe"]
