from tokenedge.experiments import (
    e1_main_comparison,
    e2_cost_sensitivity,
    e4_lookahead_demo,
    e6_accuracy_vs_profit,
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


def test_e4_shows_leaks_inflate_results(sandbox):
    e4 = e4_lookahead_demo("SYN", "yfinance", "1d").set_index("variant")
    assert e4.loc["leak_peek_one_bar", "sharpe"] > e4.loc["clean", "sharpe"]
