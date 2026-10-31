"""Color science used by the color-blind and low-vision personas.

Everything here is deterministic (no AI): the agent calls these functions as
tools, and the web UI uses them directly for the before/after preview.

- Color-vision-deficiency (CVD) simulation  -> Machado, Oliveira & Fernandes (2009)
- Daltonization (adapting images for a CVD) -> Fidaner et al. error-redistribution
- Low-vision adjustments                    -> contrast boost + glare softening
- WCAG 2.x contrast ratio
- Human-friendly color naming (nearest named color in CIELAB)
- Dominant palette extraction (small k-means in CIELAB)
- "Confusable pairs": colors that differ normally but collapse for this user
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------
# sRGB <-> linear <-> CIELAB
# --------------------------------------------------------------------------


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_RGB2XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)
_D65 = np.array([0.95047, 1.0, 1.08883])


def rgb_to_lab(rgb01: np.ndarray) -> np.ndarray:
    """sRGB in [0,1], shape (..., 3) -> CIELAB (..., 3)."""
    xyz = srgb_to_linear(rgb01) @ _RGB2XYZ.T / _D65
    eps, kappa = 216 / 24389, 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def rgb_to_oklab(rgb01: np.ndarray) -> np.ndarray:
    """sRGB [0,1] -> OKLab (Ottosson 2020). Hue is far more uniform than CIELAB
    in the blues, so it is used for naming (CIELAB famously calls #0000ff violet)."""
    lin = srgb_to_linear(rgb01)
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    return np.cbrt(lin @ m1.T) @ m2.T


def delta_e(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIE76 color difference. ~2.3 = just noticeable, >10 = clearly different."""
    return np.linalg.norm(np.asarray(lab1) - np.asarray(lab2), axis=-1)


# --------------------------------------------------------------------------
# Hex helpers
# --------------------------------------------------------------------------


def hex_to_rgb01(hex_str: str) -> np.ndarray:
    h = hex_str.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in h):
        raise ValueError(f"Not a valid hex color: {hex_str!r}")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


def rgb01_to_hex(rgb: Iterable[float]) -> str:
    r, g, b = (int(round(float(np.clip(v, 0, 1)) * 255)) for v in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


# --------------------------------------------------------------------------
# CVD simulation (Machado 2009, severity 1.0 matrices, applied in linear RGB)
# --------------------------------------------------------------------------

CVD_TYPES = ("none", "protan", "deutan", "tritan", "achroma")

CVD_LABELS = {
    "none": "Typical color vision",
    "protan": "Protanopia / protanomaly (reduced red sensitivity)",
    "deutan": "Deuteranopia / deuteranomaly (reduced green sensitivity)",
    "tritan": "Tritanopia / tritanomaly (reduced blue sensitivity)",
    "achroma": "Achromatopsia (little or no color)",
}

_MACHADO = {
    "protan": np.array(
        [
            [0.152286, 1.052583, -0.204868],
            [0.114503, 0.786281, 0.099216],
            [-0.003882, -0.048116, 1.051998],
        ]
    ),
    "deutan": np.array(
        [
            [0.367322, 0.860646, -0.227968],
            [0.280085, 0.672501, 0.047413],
            [-0.011820, 0.042940, 0.968881],
        ]
    ),
    "tritan": np.array(
        [
            [1.255528, -0.076749, -0.178779],
            [-0.078411, 0.930809, 0.147602],
            [0.004733, 0.691367, 0.303900],
        ]
    ),
}
_LUMA = np.array([0.2126, 0.7152, 0.0722])


def cvd_matrix(cvd: str, severity: float = 1.0) -> np.ndarray:
    """3x3 linear-RGB matrix. Severity in [0,1] blends from identity to full."""
    s = float(np.clip(severity, 0.0, 1.0))
    if cvd in (None, "none"):
        return np.eye(3)
    if cvd == "achroma":
        full = np.tile(_LUMA, (3, 1))
    elif cvd in _MACHADO:
        full = _MACHADO[cvd]
    else:
        raise ValueError(f"Unknown CVD type {cvd!r}; expected one of {CVD_TYPES}")
    return (1 - s) * np.eye(3) + s * full


def simulate(rgb01: np.ndarray, cvd: str, severity: float = 1.0) -> np.ndarray:
    """How sRGB colors (..., 3) in [0,1] appear to someone with `cvd`."""
    lin = srgb_to_linear(rgb01)
    out = lin @ cvd_matrix(cvd, severity).T
    return linear_to_srgb(out)


# --------------------------------------------------------------------------
# Adaptation ("fix it for me")
# --------------------------------------------------------------------------

# Where to move the information this viewer can't see.
_DALTON_SHIFT = {
    # red/green confusion -> push the lost difference into lightness/blue
    "protan": np.array([[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]]),
    "deutan": np.array([[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]]),
    # blue/yellow confusion -> push into red/green
    "tritan": np.array([[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]]),
}


@dataclass
class Adjustments:
    cvd: str = "none"
    severity: float = 1.0
    contrast_boost: float = 0.0  # 0..1
    soften_glare: bool = False  # tame bright whites for light sensitivity
    strength: float = 1.0  # how strongly to daltonize, 0..1.5

    @classmethod
    def from_profile(cls, profile: dict) -> "Adjustments":
        return cls(
            cvd=profile.get("cvd_type", "none") or "none",
            severity=float(profile.get("severity", 1.0)),
            contrast_boost=float(profile.get("contrast_boost", 0.0)),
            soften_glare=bool(profile.get("light_sensitive", False)),
            strength=float(profile.get("adapt_strength", 1.0)),
        )


def daltonize(rgb01: np.ndarray, cvd: str, severity: float = 1.0, strength: float = 1.0) -> np.ndarray:
    if cvd not in _DALTON_SHIFT:
        return np.asarray(rgb01, dtype=np.float64)
    sim = simulate(rgb01, cvd, severity)
    err = np.asarray(rgb01) - sim
    shifted = err @ _DALTON_SHIFT[cvd].T
    return np.clip(rgb01 + strength * shifted, 0, 1)


def _boost_contrast(rgb01: np.ndarray, amount: float) -> np.ndarray:
    if amount <= 0:
        return rgb01
    # S-curve around mid-grey in perceptual space
    k = 1 + 1.5 * amount
    return np.clip(0.5 + (rgb01 - 0.5) * k, 0, 1)


def _soften_glare(rgb01: np.ndarray) -> np.ndarray:
    # Compress the top of the range and warm it slightly (less blue light).
    out = np.where(rgb01 > 0.75, 0.75 + (rgb01 - 0.75) * 0.45, rgb01)
    out = out * np.array([1.0, 0.98, 0.9])
    return np.clip(out, 0, 1)


def adapt(rgb01: np.ndarray, adj: Adjustments) -> np.ndarray:
    out = np.asarray(rgb01, dtype=np.float64)
    if adj.cvd == "achroma":
        # No hue to rescue; maximise lightness separation instead.
        out = _boost_contrast(out, max(adj.contrast_boost, 0.4))
    else:
        out = daltonize(out, adj.cvd, adj.severity, adj.strength)
        out = _boost_contrast(out, adj.contrast_boost)
    if adj.soften_glare:
        out = _soften_glare(out)
    return out


# --------------------------------------------------------------------------
# Image-level helpers
# --------------------------------------------------------------------------


def image_to_array(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0


def array_to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def simulate_image(img: Image.Image, cvd: str, severity: float = 1.0) -> Image.Image:
    return array_to_image(simulate(image_to_array(img), cvd, severity))


def adapt_image(img: Image.Image, adj: Adjustments) -> Image.Image:
    return array_to_image(adapt(image_to_array(img), adj))


def crop_fraction(img: Image.Image, region: dict | None) -> Image.Image:
    """region = {x0,y0,x1,y1} as fractions 0..1 of width/height."""
    if not region:
        return img
    w, h = img.size
    x0, y0 = float(region.get("x0", 0)), float(region.get("y0", 0))
    x1, y1 = float(region.get("x1", 1)), float(region.get("y1", 1))
    x0, x1 = sorted((np.clip(x0, 0, 1), np.clip(x1, 0, 1)))
    y0, y1 = sorted((np.clip(y0, 0, 1), np.clip(y1, 0, 1)))
    box = (int(x0 * w), int(y0 * h), max(int(x1 * w), int(x0 * w) + 1), max(int(y1 * h), int(y0 * h) + 1))
    return img.crop(box)


# --------------------------------------------------------------------------
# WCAG contrast
# --------------------------------------------------------------------------


def relative_luminance(rgb01: np.ndarray) -> float:
    return float(srgb_to_linear(rgb01) @ _LUMA)


def contrast_ratio(fg_hex: str, bg_hex: str) -> dict:
    l1 = relative_luminance(hex_to_rgb01(fg_hex))
    l2 = relative_luminance(hex_to_rgb01(bg_hex))
    hi, lo = max(l1, l2), min(l1, l2)
    ratio = (hi + 0.05) / (lo + 0.05)
    return {
        "foreground": fg_hex,
        "background": bg_hex,
        "ratio": round(ratio, 2),
        "AA_normal_text": ratio >= 4.5,
        "AA_large_text": ratio >= 3.0,
        "AAA_normal_text": ratio >= 7.0,
        "AAA_large_text": ratio >= 4.5,
        "ui_components": ratio >= 3.0,
    }


def suggest_accessible_color(fg_hex: str, bg_hex: str, target: float = 4.5) -> str | None:
    """Nudge fg lighter or darker (keeping hue) until it meets `target` on bg."""
    fg = hex_to_rgb01(fg_hex)
    bg_lum = relative_luminance(hex_to_rgb01(bg_hex))
    go_dark = bg_lum > 0.18
    for step in np.linspace(0, 1, 101):
        cand = fg * (1 - step) if go_dark else fg + (1 - fg) * step
        if contrast_ratio(rgb01_to_hex(cand), bg_hex)["ratio"] >= target:
            return rgb01_to_hex(cand)
    return None


# --------------------------------------------------------------------------
# Color naming
# --------------------------------------------------------------------------

# Friendly everyday names. Kept small on purpose: people want "olive green",
# not "#6b8e23 (OliveDrab)".
NAMED_COLORS: dict[str, str] = {
    "black": "#000000", "charcoal": "#36454f", "dark grey": "#555555",
    "grey": "#808080", "silver": "#c0c0c0", "light grey": "#d9d9d9", "white": "#ffffff",
    "off-white / cream": "#f5f0e1", "beige": "#d9c8a9", "tan": "#c19a6b",
    "khaki": "#bdb07a", "brown": "#7b4a2a", "dark brown": "#4a2c17", "chocolate": "#5c3317",
    "maroon": "#800000", "burgundy": "#7a1f3d", "dark red": "#9b111e", "red": "#e02424",
    "crimson": "#c41e3a", "coral": "#ff7f50", "salmon": "#f08a7a", "peach": "#ffcba4",
    "orange": "#f57c00", "burnt orange": "#c1561b", "rust": "#a0441d", "amber": "#ffbf00",
    "mustard yellow": "#d4a017", "gold": "#d4af37", "yellow": "#f7e017", "pale yellow": "#fff3a3",
    "lime green": "#9acd32", "chartreuse": "#b7e000", "olive green": "#708238", "olive": "#6b6b1f",
    "light green": "#90ee90", "green": "#2e9e44", "bright green": "#22cc33", "neon green": "#00ff00", "forest green": "#1f5e2e",
    "dark green": "#0f3d1e", "sea green": "#2e8b57", "emerald": "#1f9d6b", "mint": "#98e0c0", "sage green": "#9caf88", "teal": "#108080",
    "turquoise": "#30c5c0", "aqua / cyan": "#00d4e0", "sky blue": "#87ceeb", "light blue": "#add8e6",
    "baby blue": "#bfdfff", "blue": "#1f5fe0", "bright blue": "#0000ff", "royal blue": "#3050c8", "cobalt blue": "#0047ab",
    "denim blue": "#3b5b8c", "steel blue": "#4682b4", "navy blue": "#000080", "dark navy": "#141c3c", "midnight blue": "#121838",
    "indigo": "#3f2a8c", "violet": "#7f3fbf", "purple": "#6a2c91", "plum": "#8e4585",
    "lavender": "#c3b1e1", "lilac": "#c8a2c8", "magenta": "#d0208c", "hot pink": "#ff4fa0",
    "pink": "#f4a7bb", "light pink": "#fbd3dc", "dusty rose": "#c08081", "mauve": "#b784a7",
}
_NAMED_LAB = {name: rgb_to_oklab(hex_to_rgb01(h)) * 100 for name, h in NAMED_COLORS.items()}
_NAME_KEYS = list(_NAMED_LAB)
_NEUTRAL_NAMES = {"black", "charcoal", "dark grey", "grey", "silver", "light grey", "white"}
_NEUTRAL_IDX = np.array([k in _NEUTRAL_NAMES for k in _NAME_KEYS])
_NAME_LABS = np.stack([_NAMED_LAB[k] for k in _NAME_KEYS])


def name_color(hex_str: str) -> dict:
    rgb = hex_to_rgb01(hex_str)
    ok = rgb_to_oklab(rgb) * 100
    d = delta_e(_NAME_LABS, ok)
    L, a, b = rgb_to_lab(rgb)
    if np.hypot(a, b) < 6:  # essentially grey: only use grey-scale names
        d = np.where(_NEUTRAL_IDX, d, np.inf)
    i = int(np.argmin(d))
    chroma = float(np.hypot(a, b))
    lightness = "very dark" if L < 20 else "dark" if L < 40 else "medium" if L < 65 else "light" if L < 85 else "very light"
    saturation = "greyish/neutral" if chroma < 8 else "muted" if chroma < 30 else "vivid"
    return {
        "hex": hex_str.lower() if hex_str.startswith("#") else "#" + hex_str.lower(),
        "name": _NAME_KEYS[i],
        "closeness": "exact" if d[i] < 3 else "close" if d[i] < 8 else "approximate",
        "lightness": lightness,
        "saturation": saturation,
        "description": f"{_NAME_KEYS[i]} ({lightness}, {saturation})",
    }


# --------------------------------------------------------------------------
# Palette extraction
# --------------------------------------------------------------------------


def extract_palette(img: Image.Image, k: int = 6, region: dict | None = None, max_side: int = 160) -> list[dict]:
    """Dominant colors via k-means in CIELAB. Deterministic."""
    sub = crop_fraction(img, region).convert("RGB")
    sub.thumbnail((max_side, max_side))
    px = image_to_array(sub).reshape(-1, 3)
    if len(px) == 0:
        return []
    lab = rgb_to_lab(px)
    k = int(max(1, min(k, len(np.unique(px.round(3), axis=0)))))

    # k-means++ style deterministic init: start from the most common-ish pixel,
    # then repeatedly take the pixel farthest from existing centers.
    centers = [lab[np.argmin(delta_e(lab, np.median(lab, axis=0)))]]
    for _ in range(1, k):
        dist = np.min(np.stack([delta_e(lab, c) for c in centers]), axis=0)
        centers.append(lab[int(np.argmax(dist))])
    centers = np.stack(centers)

    for _ in range(15):
        labels = np.argmin(np.stack([delta_e(lab, c) for c in centers]), axis=0)
        new = np.stack([lab[labels == j].mean(axis=0) if np.any(labels == j) else centers[j] for j in range(k)])
        if np.allclose(new, centers, atol=0.05):
            break
        centers = new

    out = []
    for j in range(k):
        mask = labels == j
        if not np.any(mask):
            continue
        rgb = px[mask].mean(axis=0)
        hx = rgb01_to_hex(rgb)
        out.append({**name_color(hx), "share": round(float(mask.mean()), 3)})
    out.sort(key=lambda c: -c["share"])
    return out


def key_colors(img: Image.Image, k: int = 8, region: dict | None = None) -> list[dict]:
    """The colors that *matter* in an image.

    Flat graphics (charts, maps, UI, logos) are made of a few exact colors, and
    k-means on them returns anti-aliasing blends ("salmon" = red edge on white).
    So first look for colors that repeat exactly; only if the image doesn't
    have them (a photo) fall back to k-means.
    """
    sub = crop_fraction(img, region).convert("RGB")
    arr = np.asarray(sub, dtype=np.uint8).reshape(-1, 3)
    total = len(arr)
    if total == 0:
        return []
    q = (arr >> 3).astype(np.int32)
    codes = (q[:, 0] << 10) | (q[:, 1] << 5) | q[:, 2]
    uniq, inverse, counts = np.unique(codes, return_inverse=True, return_counts=True)
    order = np.argsort(-counts)
    min_count = max(3, int(0.0008 * total))

    accepted: list[tuple[np.ndarray, np.ndarray, int]] = []  # (rgb01, lab, count)
    for idx in order[:120]:
        if counts[idx] < min_count or len(accepted) >= k:
            break
        rgb = arr[inverse == idx].mean(axis=0) / 255.0
        lab = rgb_to_lab(rgb)
        if all(delta_e(lab, a[1]) > 8 for a in accepted):
            accepted.append((rgb, lab, int(counts[idx])))
        else:  # fold near-duplicates into the closest accepted color
            j = int(np.argmin([delta_e(lab, a[1]) for a in accepted]))
            accepted[j] = (accepted[j][0], accepted[j][1], accepted[j][2] + int(counts[idx]))

    coverage = sum(a[2] for a in accepted) / total
    if coverage < 0.6:  # photo-like: no dominant flat colors
        return extract_palette(img, k=k, region=region)
    out = [{**name_color(rgb01_to_hex(rgb)), "share": round(c / total, 4)} for rgb, _, c in accepted]
    out.sort(key=lambda c: -c["share"])
    return out


def sample_point(img: Image.Image, x: float, y: float, radius_frac: float = 0.01) -> dict:
    """Average color around (x,y) given as fractions of width/height."""
    w, h = img.size
    r = max(1, int(radius_frac * max(w, h)))
    cx, cy = int(np.clip(x, 0, 1) * (w - 1)), int(np.clip(y, 0, 1) * (h - 1))
    box = (max(0, cx - r), max(0, cy - r), min(w, cx + r + 1), min(h, cy + r + 1))
    rgb = image_to_array(img.crop(box)).reshape(-1, 3).mean(axis=0)
    return name_color(rgb01_to_hex(rgb))


# --------------------------------------------------------------------------
# Confusable pairs
# --------------------------------------------------------------------------


def find_confusable_pairs(
    colors: list[str],
    cvd: str,
    severity: float = 1.0,
    min_normal_diff: float = 20.0,
    max_seen_diff: float = 12.0,
) -> list[dict]:
    """Pairs that look clearly different to typical vision but similar to this viewer."""
    if cvd in (None, "none") or len(colors) < 2:
        return []
    rgbs = np.stack([hex_to_rgb01(c) for c in colors])
    lab_normal = rgb_to_lab(rgbs)
    lab_seen = rgb_to_lab(simulate(rgbs, cvd, severity))
    pairs = []
    for i in range(len(colors)):
        for j in range(i + 1, len(colors)):
            dn = float(delta_e(lab_normal[i], lab_normal[j]))
            ds = float(delta_e(lab_seen[i], lab_seen[j]))
            if dn >= min_normal_diff and ds <= max_seen_diff:
                pairs.append(
                    {
                        "a": name_color(colors[i]),
                        "b": name_color(colors[j]),
                        "difference_typical_vision": round(dn, 1),
                        "difference_for_you": round(ds, 1),
                        "how_a_looks_to_you": rgb01_to_hex(simulate(rgbs[i], cvd, severity)),
                        "how_b_looks_to_you": rgb01_to_hex(simulate(rgbs[j], cvd, severity)),
                        "tip": _distinguish_tip(lab_seen[i], lab_seen[j], colors[i], colors[j]),
                    }
                )
    pairs.sort(key=lambda p: p["difference_for_you"])
    return pairs


def _distinguish_tip(lab_a, lab_b, hex_a, hex_b) -> str:
    dl = float(lab_a[0] - lab_b[0])
    na, nb = name_color(hex_a)["name"], name_color(hex_b)["name"]
    if abs(dl) >= 5:
        lighter, darker = (na, nb) if dl > 0 else (nb, na)
        return f"The {lighter} is slightly lighter than the {darker}; use brightness, labels or position to tell them apart."
    return f"{na} and {nb} look nearly identical to you; rely on labels, patterns or position, not color."
