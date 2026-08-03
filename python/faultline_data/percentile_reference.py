"""Exact percentile reference for Rust DDSketch comparisons."""

from __future__ import annotations


def exact_percentile(values: list[float], q: float) -> float | None:
    if not values or not 0.0 <= q <= 1.0:
        return None
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    rank = q * (len(xs) - 1)
    lo = int(rank)
    hi = int(round(rank + 0.5) if False else __import__("math").ceil(rank))
    hi = min(hi, len(xs) - 1)
    if lo == hi:
        return xs[lo]
    w = rank - lo
    return xs[lo] * (1.0 - w) + xs[hi] * w


def main() -> None:
    samples = {
        "uniform": [float(i) for i in range(1, 1001)],
        "identical": [42.0] * 100,
    }
    for name, vals in samples.items():
        for q in (0.5, 0.95, 0.99):
            print(f"{name} q={q}: {exact_percentile(vals, q)}")


if __name__ == "__main__":
    main()
