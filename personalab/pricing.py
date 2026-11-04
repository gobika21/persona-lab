"""What a run costs in dollars, from its token counts.

Prices are Anthropic first-party API rates per million tokens (claude-api skill table, cached 2026-10-06).
PRICE_*_PER_MTOK env vars override them, e.g. for another model or a changed price list."""
import os

# input, output, cache read, cache write (5-minute cache: 1.25x input)
PRICES = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
}


def prices(model: str | None) -> tuple[float, float, float, float] | None:
    pin, pout = os.environ.get("PRICE_INPUT_PER_MTOK"), os.environ.get("PRICE_OUTPUT_PER_MTOK")
    if pin and pout:
        pin, pout = float(pin), float(pout)
        return (pin, pout, float(os.environ.get("PRICE_CACHE_READ_PER_MTOK") or pin * 0.1),
                float(os.environ.get("PRICE_CACHE_WRITE_PER_MTOK") or pin * 1.25))
    return PRICES.get(model or "")


def cost_usd(model: str | None, input_tokens: int = 0, output_tokens: int = 0,
             cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> float | None:
    """None when the model's price isn't known (rather than a made-up number)."""
    p = prices(model)
    if p is None:
        return None
    return round((input_tokens * p[0] + output_tokens * p[1] + cache_read_tokens * p[2] + cache_write_tokens * p[3]) / 1e6, 4)
