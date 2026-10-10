"""Genere les 50 icones d'application predefinies (client/public/app-icons/1..50.png).

Variantes de couleurs, degrades, fonds et formes du logo ForgeChat : les lettres
« FC » et les points sont extraits de desktop/src-tauri/icons/icon.png puis poses
sur un nouveau fond. Sortie 128 x 128 (barre des taches, zone de notification,
favicon), PNG optimise. Relancer apres un changement du logo :
    python scripts/gen-app-icons.py
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "desktop/src-tauri/icons/icon.png"
OUT = ROOT / "client/public/app-icons"
SIZE = 512
FINAL = 128


def masks():
    im = Image.open(SRC).convert("RGBA")
    assert im.size == (SIZE, SIZE), im.size
    r, g, b, a = im.split()
    # Points jaunes (255,222,63) sur fond bleu (b ~ 239) ; lettres blanches (g 255 sur g ~ 78).
    dot = b.point(lambda v: max(0, min(255, round((239 - v) * 255 / 176))))
    letters = ImageChops.subtract(g.point(lambda v: max(0, min(255, round((v - 92) * 255 / 163)))),
                                  dot.point(lambda v: round(v * 130 / 163)))
    return a, letters, dot


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def gradient(c1, c2):
    a, b = hexrgb(c1), hexrgb(c2)
    # Degrade diagonal (haut gauche -> bas droite), comme le logo d'origine.
    grad = Image.linear_gradient("L").resize((SIZE, SIZE))
    grad = ImageChops.add(grad, grad.rotate(90), scale=2.0)
    return Image.composite(Image.new("RGB", (SIZE, SIZE), b), Image.new("RGB", (SIZE, SIZE), a), grad)


def render(bg, fg, dots, shape, base_alpha, letters, dot):
    img = bg.copy()
    img.paste(Image.new("RGB", (SIZE, SIZE), hexrgb(fg)), mask=letters)
    img.paste(Image.new("RGB", (SIZE, SIZE), hexrgb(dots)), mask=dot)
    if shape == "circle":
        alpha = Image.new("L", (SIZE, SIZE), 0)
        ImageDraw.Draw(alpha).ellipse((8, 8, SIZE - 8, SIZE - 8), fill=255)
    else:
        alpha = base_alpha
    img.putalpha(alpha)
    return img.resize((FINAL, FINAL), Image.LANCZOS)


GRADIENTS = [
    ("#5865F2", "#7C3AED"), ("#06B6D4", "#3B82F6"), ("#10B981", "#059669"), ("#F59E0B", "#EF4444"),
    ("#EC4899", "#8B5CF6"), ("#F43F5E", "#F97316"), ("#0EA5E9", "#22C55E"), ("#6366F1", "#EC4899"),
    ("#14B8A6", "#6366F1"), ("#84CC16", "#14B8A6"), ("#A855F7", "#3B82F6"), ("#EF4444", "#7F1D1D"),
    ("#1E3A8A", "#0F172A"), ("#FBBF24", "#D97706"), ("#64748B", "#1E293B"), ("#D946EF", "#F43F5E"),
]
SOLIDS = ["#5865F2", "#2563EB", "#16A34A", "#DC2626", "#EA580C", "#CA8A04", "#DB2777", "#7C3AED", "#0D9488", "#475569"]
DARK = [("#0F172A", c) for c in ("#818CF8", "#38BDF8", "#4ADE80", "#F87171", "#FB923C", "#FACC15", "#F472B6", "#FFFFFF")]
LIGHT = [("#F8FAFC", c) for c in ("#5865F2", "#2563EB", "#16A34A", "#DC2626", "#EA580C", "#DB2777", "#7C3AED", "#0F172A")]
CIRCLES = [("#5865F2", "#7C3AED"), ("#06B6D4", "#3B82F6"), ("#10B981", "#059669"), ("#F59E0B", "#EF4444"),
           ("#EC4899", "#8B5CF6"), ("#0F172A", "#334155"), ("#F43F5E", "#F97316"), ("#14B8A6", "#6366F1")]


def main():
    alpha, letters, dot = masks()
    variants = []
    variants += [(gradient(a, b), "#FFFFFF", "#FCD34D", "square") for a, b in GRADIENTS]
    variants += [(Image.new("RGB", (SIZE, SIZE), hexrgb(c)), "#FFFFFF", "#FCD34D", "square") for c in SOLIDS]
    variants += [(Image.new("RGB", (SIZE, SIZE), hexrgb(bg)), fg, "#FCD34D", "square") for bg, fg in DARK]
    variants += [(Image.new("RGB", (SIZE, SIZE), hexrgb(bg)), fg, "#F59E0B", "square") for bg, fg in LIGHT]
    variants += [(gradient(a, b), "#FFFFFF", "#FCD34D", "circle") for a, b in CIRCLES]
    assert len(variants) == 50, len(variants)
    OUT.mkdir(parents=True, exist_ok=True)
    for i, (bg, fg, dots, shape) in enumerate(variants, 1):
        render(bg, fg, dots, shape, alpha, letters, dot).save(OUT / f"{i}.png", optimize=True)
    print(f"{len(variants)} icones -> {OUT}")


if __name__ == "__main__":
    main()
