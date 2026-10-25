"""Backtest statistics: Probabilistic / Deflated Sharpe Ratio and a paired block bootstrap.

References: Bailey & López de Prado (2012, 2014); Politis & Romano (1994).
"""

from __future__ import annotations

import math

import numpy as np
from scipy import stats

EULER_GAMMA = 0.5772156649015329
# Below this per-period standard deviation a return series is treated as constant (flat
# equity): floating-point noise must not turn "no trades" into a huge Sharpe ratio.
MIN_STD = 1e-12


def _clean_returns(returns) -> np.ndarray:
    x = np.asarray(returns, dtype="float64")
    return x[np.isfinite(x)]


def sharpe_per_period(returns, rf_per_period: float = 0.0) -> float:
    x = _clean_returns(returns) - rf_per_period
    if len(x) < 2:
        return float("nan")
    sd = x.std(ddof=1)
    return float(x.mean() / sd) if sd > MIN_STD else 0.0


def _moments(x: np.ndarray) -> tuple[float, float]:
    if len(x) < 4 or x.std() <= MIN_STD:
        return 0.0, 3.0
    skew = float(stats.skew(x, bias=False))
    kurt = float(stats.kurtosis(x, fisher=False, bias=False))
    return skew, kurt


def sharpe_estimator_variance(sr: float, skew: float, kurt: float, n: int) -> float:
    """Variance of the (per-period) Sharpe ratio estimator under non-normal returns."""
    return max(1.0 - skew * sr + (kurt - 1.0) / 4.0 * sr**2, 1e-12) / max(n - 1, 1)


def probabilistic_sharpe_ratio(
    returns, sr_benchmark: float = 0.0, rf_per_period: float = 0.0
) -> float:
    """P(true Sharpe > sr_benchmark); both Sharpe values are per period (not annualized)."""
    x = _clean_returns(returns) - rf_per_period
    n = len(x)
    if n < 4 or x.std(ddof=1) <= MIN_STD:
        return float("nan")
    sr = float(x.mean() / x.std(ddof=1))
    skew, kurt = _moments(x)
    denom = math.sqrt(max(1.0 - skew * sr + (kurt - 1.0) / 4.0 * sr**2, 1e-12))
    return float(stats.norm.cdf((sr - sr_benchmark) * math.sqrt(n - 1) / denom))


def expected_max_sharpe(n_trials: int, sr_variance: float) -> float:
    """SR0: the Sharpe ratio expected from the best of ``n_trials`` skill-less trials."""
    if n_trials <= 1 or sr_variance <= 0:
        return 0.0
    k = float(n_trials)
    z1 = stats.norm.ppf(1.0 - 1.0 / k)
    z2 = stats.norm.ppf(1.0 - 1.0 / (k * math.e))
    return float(math.sqrt(sr_variance) * ((1.0 - EULER_GAMMA) * z1 + EULER_GAMMA * z2))


def deflated_sharpe_ratio(
    returns,
    n_trials: int,
    periods_per_year: float,
    rf_annual: float = 0.0,
    trial_sharpe_std_annual: float | None = None,
) -> dict:
    """DSR = PSR(SR0), where SR0 accounts for the number of strategy variants tried.

    If the dispersion of the trial Sharpe ratios is unknown, the variance of the Sharpe
    estimator itself is used, which is a common conservative-enough fallback.
    """
    rf = rf_annual / periods_per_year
    x = _clean_returns(returns) - rf
    n = len(x)
    if n < 4 or x.std(ddof=1) <= MIN_STD:
        return {"dsr": None, "sr0_annual": None, "n_trials": n_trials}
    sr = float(x.mean() / x.std(ddof=1))
    skew, kurt = _moments(x)
    if trial_sharpe_std_annual is not None and trial_sharpe_std_annual > 0:
        var = (trial_sharpe_std_annual / math.sqrt(periods_per_year)) ** 2
    else:
        var = sharpe_estimator_variance(sr, skew, kurt, n)
    sr0 = expected_max_sharpe(max(int(n_trials), 1), var)
    dsr = probabilistic_sharpe_ratio(x, sr_benchmark=sr0)
    return {
        "dsr": dsr,
        "sr0_annual": sr0 * math.sqrt(periods_per_year),
        "n_trials": int(n_trials),
    }


def stationary_bootstrap_blocks(
    n: int, n_samples: int, mean_block: float, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """Block starts and lengths of stationary-bootstrap resamples (Politis & Romano).

    Each resample of length n is a sequence of circular blocks with uniform random starts and
    geometric lengths (mean ``mean_block``). Returns two (n_samples, k) arrays; unused trailing
    blocks have length 0.
    """
    p = 1.0 / max(mean_block, 1.0)
    k = int(2 * n / max(mean_block, 1.0)) + 50
    lengths = np.minimum(rng.geometric(p, size=(n_samples, k)), n)
    starts = rng.integers(0, n, size=(n_samples, k))
    before = np.cumsum(lengths, axis=1) - lengths  # bars filled before each block
    lengths = np.clip(n - before, 0, lengths)
    short = n - lengths.sum(axis=1)  # practically never > 0 with the 2x margin
    if short.any():
        lengths[:, -1] += short
    return starts, lengths


def _block_sums(prefix: np.ndarray, starts: np.ndarray, lengths: np.ndarray) -> np.ndarray:
    return (prefix[starts + lengths] - prefix[starts]).sum(axis=1)


def _sharpe_from_sums(
    s1: np.ndarray, s2: np.ndarray, n: int, periods_per_year: float
) -> np.ndarray:
    mean = s1 / n
    var = np.maximum((s2 - n * mean**2) / (n - 1), 0.0)
    sd = np.sqrt(var)
    out = np.zeros_like(mean)
    ok = sd > MIN_STD
    out[ok] = mean[ok] / sd[ok] * math.sqrt(periods_per_year)
    return out


def _sharpe_rows(x: np.ndarray, periods_per_year: float) -> np.ndarray:
    mean = x.mean(axis=1)
    sd = x.std(axis=1, ddof=1)
    out = np.zeros_like(mean)
    ok = sd > MIN_STD
    out[ok] = mean[ok] / sd[ok] * math.sqrt(periods_per_year)
    return out


def bootstrap_sharpe_difference(
    returns_a,
    returns_b,
    periods_per_year: float,
    n_samples: int = 5000,
    block_size: float | None = None,
    seed: int = 42,
    bins: int = 40,
    rf_annual: float = 0.0,
) -> dict | None:
    """Paired stationary bootstrap of SR(a) - SR(b) (annualized, on excess returns).

    ``rf_annual`` must match the rate used for the reported Sharpe ratios so the point
    estimate equals the difference of the displayed values.

    Returns the point estimate, a 95% percentile CI, a one-sided p-value for
    H0: SR(a) <= SR(b), and a histogram of the bootstrap distribution for plotting.
    """
    a = np.asarray(returns_a, dtype="float64")
    b = np.asarray(returns_b, dtype="float64")
    ok = np.isfinite(a) & np.isfinite(b)
    rf = rf_annual / periods_per_year
    a, b = a[ok] - rf, b[ok] - rf
    n = len(a)
    if n < 20:
        return None
    block = float(block_size) if block_size else max(1.0, round(n ** (1.0 / 3.0)))
    rng = np.random.default_rng(seed)
    # Prefix sums over the doubled series make every circular block sum an O(1) lookup, so a
    # resample costs O(n / block) instead of O(n).
    prefixes = [
        np.concatenate([[0.0], np.cumsum(np.concatenate([x, x]))]) for x in (a, a * a, b, b * b)
    ]
    k_est = int(2 * n / block) + 50
    chunk = max(1, min(n_samples, int(4_000_000 // k_est)))
    diffs = []
    done = 0
    while done < n_samples:
        m = min(chunk, n_samples - done)
        starts, lengths = stationary_bootstrap_blocks(n, m, block, rng)
        sa1, sa2, sb1, sb2 = (_block_sums(px, starts, lengths) for px in prefixes)
        diffs.append(
            _sharpe_from_sums(sa1, sa2, n, periods_per_year)
            - _sharpe_from_sums(sb1, sb2, n, periods_per_year)
        )
        done += m
    dist = np.concatenate(diffs)
    est = float(
        _sharpe_rows(a[None, :], periods_per_year)[0]
        - _sharpe_rows(b[None, :], periods_per_year)[0]
    )
    lo, hi = np.percentile(dist, [2.5, 97.5])
    p_value = float(np.mean((dist - est) >= est))
    counts, edges = np.histogram(dist, bins=bins)
    return {
        "estimate": est,
        "ci_low": float(lo),
        "ci_high": float(hi),
        "p_value": p_value,
        "significant": bool(lo > 0 or hi < 0),
        "samples": int(n_samples),
        "block_size": block,
        "histogram": {"edges": edges.tolist(), "counts": counts.tolist()},
    }
