"""Icônes d'application alternatives du mobile (Réglages → Apparence → Icône de l'app).

Mêmes 50 variantes que le web et le bureau (scripts/gen-app-icons.py, client/public/app-icons) :
couleurs, dégradés et formes reprises de ce script, lettres « FC » et points extraits du logo
desktop/src-tauri/icons/app-icon.png (1024 px). Produit dans mobile/assets/app-icons/ :

  preset-N.png             1024 px, carré plein et opaque (iOS, icône classique Android) ;
  preset-N-foreground.png  1024 px, avant-plan de l'icône adaptative Android (lettres et points
                           dans le cercle de sécurité 66/108, fond transparent) ;
  preview/*.png            vignettes 144 px de l'écran de choix (dont l'icône d'origine) ;
  variants.json            fonds Android (couleur, dégradé ou disque) lus par plugins/withAppIcons.js ;

et src/features/appearance/appIconPreviews.ts (require des vignettes, Metro les veut statiques).
Les tailles finales (mipmaps Android, PNG iOS) sont tirées de ces sources au prebuild.

    python3 mobile/scripts/generate-app-icons.py
"""
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

MOBILE = Path(__file__).resolve().parent.parent
ROOT = MOBILE.parent
SRC = ROOT / "desktop/src-tauri/icons/app-icon.png"
OUT = MOBILE / "assets/app-icons"
PREVIEWS_TS = MOBILE / "src/features/appearance/appIconPreviews.ts"
SIZE = 1024
PREVIEW = 144
# Fond autour du disque des variantes « rondes » (même gris que l'app, app.config.ts).
APP_BG = "#1e1f22"
# Disque des variantes rondes : marge du bureau (8 px sur 512).
CIRCLE_INSET = 16
# Avant-plan adaptatif : le contenu tient dans un cercle de 66/108 de la couche (marge comprise).
SAFE_DIAMETER = SIZE * 66 / 108


def desktop_variants():
    """Données du script du bureau (une seule source pour les couleurs des 50 icônes)."""
    sys.dont_write_bytecode = True  # pas de scripts/__pycache__ dans le dépôt
    spec = importlib.util.spec_from_file_location("gen_app_icons", ROOT / "scripts/gen-app-icons.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    v = []
    v += [({"type": "gradient", "colors": [a, b]}, "#FFFFFF", "#FCD34D") for a, b in mod.GRADIENTS]
    v += [({"type": "solid", "colors": [c]}, "#FFFFFF", "#FCD34D") for c in mod.SOLIDS]
    v += [({"type": "solid", "colors": [bg]}, fg, "#FCD34D") for bg, fg in mod.DARK]
    v += [({"type": "solid", "colors": [bg]}, fg, "#F59E0B") for bg, fg in mod.LIGHT]
    v += [({"type": "circle", "colors": [a, b], "base": APP_BG}, "#FFFFFF", "#FCD34D") for a, b in mod.CIRCLES]
    assert len(v) == 50, len(v)
    return v


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def masks():
    """Masques des lettres et des points (mêmes seuils que scripts/gen-app-icons.py)."""
    im = Image.open(SRC).convert("RGBA")
    assert im.size == (SIZE, SIZE), im.size
    _, g, b, a = im.split()
    dot = b.point(lambda v: max(0, min(255, round((239 - v) * 255 / 176))))
    letters = ImageChops.subtract(g.point(lambda v: max(0, min(255, round((v - 92) * 255 / 163)))),
                                  dot.point(lambda v: round(v * 130 / 163)))
    # Coins arrondis du logo (transparents et noirs, donc pris pour des points, jusque dans leur
    # bord adouci) : seuls les pixels pleinement opaques comptent, le dessin est loin des bords.
    inside = a.point(lambda v: 255 if v == 255 else 0)
    # Le fond le plus clair du logo laisse un voile (≈ 14/255) dans le masque des lettres : invisible
    # en 128 px sur le bureau, pas en 1024 ni sur un fond clair. Il est retiré ici.
    clean = lambda m: ImageChops.multiply(m, inside).point(lambda v: max(0, round((v - 24) * 255 / 231)))
    return clean(letters), clean(dot)


def gradient(c1, c2, size=SIZE):
    """Dégradé diagonal, haut gauche → bas droite (comme le bureau et android:angle=315)."""
    a, b = hexrgb(c1), hexrgb(c2)
    grad = Image.linear_gradient("L").resize((size, size))
    grad = ImageChops.add(grad, grad.rotate(90), scale=2.0)
    return Image.composite(Image.new("RGB", (size, size), b), Image.new("RGB", (size, size), a), grad)


def background(bg):
    if bg["type"] == "solid":
        return Image.new("RGB", (SIZE, SIZE), hexrgb(bg["colors"][0]))
    fill = gradient(*bg["colors"])
    if bg["type"] == "gradient":
        return fill
    img = Image.new("RGB", (SIZE, SIZE), hexrgb(bg["base"]))
    disc = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(disc).ellipse((CIRCLE_INSET, CIRCLE_INSET, SIZE - CIRCLE_INSET, SIZE - CIRCLE_INSET), fill=255)
    img.paste(fill, mask=disc)
    return img


def art(fg, dots, letters, dot):
    """Lettres et points colorés sur fond transparent, à leur place dans le logo."""
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", (SIZE, SIZE), hexrgb(fg) + (255,)), mask=letters)
    layer.paste(Image.new("RGBA", (SIZE, SIZE), hexrgb(dots) + (255,)), mask=dot)
    return layer


def foreground(layer):
    """Avant-plan adaptatif : le dessin recentré et réduit pour tenir dans le cercle de sécurité."""
    box = layer.getbbox()
    crop = layer.crop(box)
    w, h = crop.size
    scale = SAFE_DIAMETER / (w * w + h * h) ** 0.5
    crop = crop.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(crop, ((SIZE - crop.size[0]) // 2, (SIZE - crop.size[1]) // 2))
    return out


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


def main():
    letters, dot = masks()
    variants = []
    for n, (bg, fg, dots) in enumerate(desktop_variants(), 1):
        layer = art(fg, dots, letters, dot)
        full = background(bg).convert("RGBA")
        full.alpha_composite(layer)
        full = full.convert("RGB")  # iOS refuse la transparence dans une icône
        save(full, OUT / f"preset-{n}.png")
        save(foreground(layer), OUT / f"preset-{n}-foreground.png")
        save(full.resize((PREVIEW, PREVIEW), Image.LANCZOS), OUT / "preview" / f"preset-{n}.png")
        variants.append({"id": f"preset:{n}", "name": f"Preset{n}", "background": bg})
    # Vignettes de l'icône d'origine (profil public et profils de dev, app.config.ts : ASSETS).
    for name, src in (("default", MOBILE / "assets/icon.png"), ("default-dev", MOBILE / "assets/dev/icon.png")):
        save(Image.open(src).convert("RGB").resize((PREVIEW, PREVIEW), Image.LANCZOS), OUT / "preview" / f"{name}.png")
    (OUT / "variants.json").write_text(json.dumps(variants, indent=2) + "\n", encoding="utf-8")

    lines = [
        "// Généré par scripts/generate-app-icons.py : ne pas modifier à la main.",
        "// Vignettes de l'écran « Icône de l'app » (Metro n'accepte que des require statiques).",
        "import type { ImageSourcePropType } from 'react-native'",
        "",
        "export const DEFAULT_PREVIEW: ImageSourcePropType = require('../../../assets/app-icons/preview/default.png')",
        "export const DEFAULT_DEV_PREVIEW: ImageSourcePropType = require('../../../assets/app-icons/preview/default-dev.png')",
        "",
        "/** Vignette de chaque icône prédéfinie, par numéro (1 à 50, comme `preset:N` du web). */",
        "export const PRESET_PREVIEWS: Record<number, ImageSourcePropType> = {",
    ]
    lines += [f"  {n}: require('../../../assets/app-icons/preview/preset-{n}.png')," for n in range(1, len(variants) + 1)]
    lines += ["}", ""]
    PREVIEWS_TS.write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(variants)} icônes -> {OUT}")


if __name__ == "__main__":
    main()
