"""Icônes d'application alternatives du mobile (Réglages → Apparence → Icône de l'app).

Mêmes variantes que le web et le bureau : catalogue de scripts/gen-app-icons.py (coloris du logo
3D de scripts/forgelogo.py), rendu par Chrome headless. Produit dans mobile/assets/app-icons/ :

  preset-N.png             192 px, carré plein et opaque (iOS 180 px au plus, icône classique
                           Android 48 dp × 4) ;
  preset-N-foreground.png  432 px (108 dp × 4), avant-plan de l'icône adaptative Android (logo dans
                           le cercle de sécurité 66/108, fond transparent) ;
  preview/*.png            vignettes 144 px de l'écran de choix (dont l'icône d'origine) ;
  variants.json            fonds Android (couleur, dégradé, bandes ou disque) lus par plugins/withAppIcons.js ;

et src/features/appearance/appIconPreviews.ts (require des vignettes, Metro les veut statiques ;
familles et noms) ; APP_ICON_COUNT (appIconIds.ts) suit le catalogue. Les sources sont à la taille
finale la plus grande (pas 1024 px) et en PNG à palette (imagequant) : 150+ variantes restent
légères dans le dépôt. Les tailles finales (mipmaps Android, PNG iOS) sont tirées au prebuild.

    python3 mobile/scripts/generate-app-icons.py
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

from PIL import Image

MOBILE = Path(__file__).resolve().parent.parent
ROOT = MOBILE.parent
OUT = MOBILE / "assets/app-icons"
PREVIEWS_TS = MOBILE / "src/features/appearance/appIconPreviews.ts"
IDS_TS = MOBILE / "src/features/appearance/appIconIds.ts"
FULL = 192
FOREGROUND = 432
PREVIEW = 144


def catalogue():
    """Le module du web et du bureau (une seule source pour les couleurs des icônes)."""
    sys.dont_write_bytecode = True  # pas de scripts/__pycache__ dans le dépôt
    spec = importlib.util.spec_from_file_location("gen_app_icons", ROOT / "scripts/gen-app-icons.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def background(p):
    """Fond de l'icône adaptative Android (plugins/withAppIcons.js : backgroundDrawable)."""
    if p.get("stripes"):
        return {"type": "stripes", "colors": list(p["stripes"])}
    colors = list(dict.fromkeys(c.upper() for c in p["bg"]))
    if p.get("shape") == "circle":
        return {"type": "circle", "colors": colors[:3] if len(colors) > 1 else colors * 2, "base": p["base"]}
    if len(colors) == 1:
        return {"type": "solid", "colors": colors}
    return {"type": "gradient", "colors": colors[:3]}


def main():
    mod = catalogue()
    F = mod.F
    items = mod.presets()
    palettes = [p for *_, p in items]
    full = F.render_palettes(palettes, "full", 512)
    fg = F.render_palettes(palettes, "foreground", 864)
    for old in list(OUT.glob("preset-*.png")) + list((OUT / "preview").glob("preset-*.png")):
        old.unlink()
    variants = []
    for (n, gid, name, p), f, g in zip(items, full, fg):
        f = f.convert("RGB")  # iOS refuse la transparence dans une icône
        F.save_png(f.resize((FULL, FULL), Image.LANCZOS), OUT / f"preset-{n}.png", quantize=True)
        F.save_png(g.resize((FOREGROUND, FOREGROUND), Image.LANCZOS), OUT / f"preset-{n}-foreground.png", quantize=True)
        F.save_png(f.resize((PREVIEW, PREVIEW), Image.LANCZOS), OUT / "preview" / f"preset-{n}.png", quantize=True)
        variants.append({"id": f"preset:{n}", "name": f"Preset{n}", "background": background(p)})
    # Vignettes de l'icône d'origine (profil public et profils de dev, app.config.ts : ASSETS).
    for name, src in (("default", MOBILE / "assets/icon.png"), ("default-dev", MOBILE / "assets/dev/icon.png")):
        F.save_png(Image.open(src).convert("RGB").resize((PREVIEW, PREVIEW), Image.LANCZOS), OUT / "preview" / f"{name}.png", quantize=True)
    (OUT / "variants.json").write_text(json.dumps(variants, indent=1) + "\n", encoding="utf-8")

    lines = [
        "// Généré par scripts/generate-app-icons.py : ne pas modifier à la main.",
        "// Vignettes de l'écran « Icône de l'app » (Metro n'accepte que des require statiques).",
        "import type { ImageSourcePropType } from 'react-native'",
        "",
        "export const DEFAULT_PREVIEW: ImageSourcePropType = require('../../../assets/app-icons/preview/default.png')",
        "export const DEFAULT_DEV_PREVIEW: ImageSourcePropType = require('../../../assets/app-icons/preview/default-dev.png')",
        "",
        f"/** Vignette de chaque icône prédéfinie, par numéro (1 à {len(items)}, comme `preset:N` du web). */",
        "export const PRESET_PREVIEWS: Record<number, ImageSourcePropType> = {",
    ]
    lines += [f"  {n}: require('../../../assets/app-icons/preview/preset-{n}.png')," for n, *_ in items]
    lines += [
        "}",
        "",
        "/** Familles et noms des icônes (mêmes que le web, scripts/gen-app-icons.py). */",
        "export const PRESET_GROUPS: { id: string; label: string; presets: { n: number; name: string }[] }[] = [",
    ]
    for gid, label, _ in mod.G:
        members = ", ".join(f"{{ n: {n}, name: '{name}' }}" for n, g, name, _ in items if g == gid)
        lines.append(f"  {{ id: '{gid}', label: '{label}', presets: [{members}] }},")
    lines += ["]", ""]
    PREVIEWS_TS.write_text("\n".join(lines), encoding="utf-8")
    src = IDS_TS.read_text(encoding="utf-8")
    IDS_TS.write_text(re.sub(r"APP_ICON_COUNT = \d+", f"APP_ICON_COUNT = {len(items)}", src), encoding="utf-8")
    print(f"{len(items)} icônes -> {OUT}")


if __name__ == "__main__":
    main()
