"""Engine parity with Backtrader (FR-E11). Run with: pytest -m crosscheck"""

import importlib.util

import pytest

pytestmark = [
    pytest.mark.crosscheck,
    pytest.mark.skipif(
        importlib.util.find_spec("backtrader") is None, reason="backtrader not installed"
    ),
]


@pytest.mark.parametrize("commission_bps,slippage_bps", [(0, 0), (10, 0), (10, 5)])
def test_sma_parity_with_backtrader(daily, commission_bps, slippage_bps):
    from tokenedge.compat.backtrader_check import crosscheck_sma

    res = crosscheck_sma(daily, 20, 50, commission_bps, slippage_bps)
    assert res["tokenedge"]["entries"] == res["backtrader"]["entries"]
    assert res["return_diff_pp"] < 0.5
