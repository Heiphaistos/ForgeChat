"""Icône principale ForgeChat (logo 3D, scripts/forgelogo.py) pour toutes les plateformes.

Produit, à partir du même SVG procédural rendu par Chrome headless :
  desktop/src-tauri/icons/   app-icon.png (1024), icon.png (512), 32/64/128/256, Square*Logo,
                             StoreLogo, icon.ico (16 à 256), icon.icns (16 à 1024), ios/ (opaques),
                             android/ (mipmaps), tray-frames/f0..f7.png (zone de notification animée) ;
  client/public/             icon.svg et icons/icon.svg (le SVG lui-même), icons/icon-180/192/512.png,
                             icons/maskable-192/512.png, favicon-frames/f0..f7.png (favicon animé) ;
  client/src/components/logoArt.ts   le SVG du logo animable (Logo3D) ;
  mobile/assets/ (et dev/)   icon.png, android-icon-background/-foreground/-monochrome.png,
                             splash-icon.png, notification-icon.png, favicon.png.

Les noms de fichiers sont ceux que référencent tauri.conf.json, manifest.json, index.html et
mobile/app.config.ts. Relancer après un changement du logo :
    python3 scripts/gen-brand-icons.py
"""
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import forgelogo as F  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DESK = ROOT / "desktop/src-tauri/icons"
PUB = ROOT / "client/public"
MOB = ROOT / "mobile/assets"
LOGO_TS = ROOT / "client/src/components/logoArt.ts"

PROD = F.palette()
DEV = F.palette(bg=["#FBBF24", "#EA580C", "#7C2D12"], glow="#FDE68A", face=["#FFFFFF", "#FFEDD5"],
                side=["#FDBA74", "#C2410C"], anvil=["#FB923C", "#EA580C", "#7C2D12"], shadow="#431407",
                badge="DEV")
FRAMES = 8


def down(img, size):
    return img if img.size[0] == size else img.resize((size, size), Image.LANCZOS)


def frame_palettes(base):
    """Boucle de l'icône animée : l'étincelle pulse et tourne, un reflet balaie la bulle."""
    out = []
    for i in range(FRAMES):
        t = i / FRAMES
        p = dict(base)
        p["spark_scale"] = 0.75 + 0.6 * math.sin(math.pi * t) ** 2
        p["spark_rot"] = 45 * t
        p["shine"] = -200 + 1300 * t
        p["twinkle"] = tuple(0.35 + 0.65 * abs(math.sin(math.pi * (t + k / 3))) for k in range(3))
        out.append(p)
    return out


def mono(size, scale):
    return F.render([F.mono_svg(size=1024, scale=scale)], 1024)[0].resize((size, size), Image.LANCZOS)


def desktop(icon, full, fg, rnd, frames):
    for size, name in ((1024, "app-icon.png"), (512, "icon.png"), (32, "32x32.png"), (64, "64x64.png"),
                       (128, "128x128.png"), (256, "128x128@2x.png"), (50, "StoreLogo.png")):
        F.save_png(down(icon, size), DESK / name)
    for s in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        F.save_png(down(icon, s), DESK / f"Square{s}x{s}Logo.png")
    icon.save(DESK / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    icon.save(DESK / "icon.icns")
    for f in sorted((DESK / "ios").glob("*.png")):
        F.save_png(down(full, Image.open(f).size[0]).convert("RGB"), f)  # iOS : opaque
    for f in sorted((DESK / "android").glob("mipmap-*/*.png")):
        size = Image.open(f).size[0]
        src = fg if f.stem.endswith("foreground") else rnd if f.stem.endswith("round") else icon
        F.save_png(down(src, size), f)
    (DESK / "android/values/ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'  <color name="ic_launcher_background">{PROD["bg"][1]}</color>\n</resources>', encoding="utf-8")
    for i, fr in enumerate(frames):
        F.save_png(down(fr, 32), DESK / f"tray-frames/f{i}.png")


def web(icon, full, maskable, frames):
    svg = F.svg(PROD, "icon", size=512)
    for path in (PUB / "icon.svg", PUB / "icons/icon.svg"):
        path.write_text(svg + "\n", encoding="utf-8")
    F.save_png(down(full, 180).convert("RGB"), PUB / "icons/icon-180.png")  # apple-touch-icon : opaque
    F.save_png(down(icon, 192), PUB / "icons/icon-192.png")
    F.save_png(down(icon, 512), PUB / "icons/icon-512.png")
    for s in (192, 512):
        F.save_png(down(maskable, s).convert("RGB"), PUB / f"icons/maskable-{s}.png")
    for i, fr in enumerate(frames):
        F.save_png(down(fr, 32), PUB / f"favicon-frames/f{i}.png")
    # Logo de l'app (Logo3D) : logo seul, reflet et braises animés en CSS.
    p = dict(PROD, shine=-400, embers=True)
    tree = svg_tree(ET.fromstring(F.svg(p, "logo", size=1024)))
    LOGO_TS.write_text(
        "// Généré par scripts/gen-brand-icons.py : ne pas modifier à la main.\n"
        "// Logo 3D (bulle, enclume, étincelle) en arbre [balise, attributs, enfants] : Logo3D le rend en\n"
        "// éléments React (pas d'innerHTML, refusé par Trusted Types) ; classes fc-* animées en CSS.\n"
        "export type LogoNode = [string, Record<string, string>, (LogoNode | string)[]]\n"
        f"export const LOGO_TREE: LogoNode = {json.dumps(tree, ensure_ascii=False, separators=(',', ':'))}\n",
        encoding="utf-8")


def svg_tree(el):
    """Élément SVG → [balise, attributs au format React (camelCase, className), enfants]."""
    def prop(name):
        name = name.split("}")[-1]
        if name == "class":
            return "className"
        head, *rest = name.split("-")
        return head + "".join(w.capitalize() for w in rest)
    kids = [svg_tree(c) for c in el]
    if el.text and el.text.strip():
        kids.insert(0, el.text.strip())
    return [el.tag.split("}")[-1], {prop(k): v for k, v in el.attrib.items() if k != "xmlns"}, kids]


def mobile(variant, out):
    icon_full, bg, fg = F.render([F.svg(variant, "full"), F.svg(variant, "background"), F.svg(variant, "foreground")], 1024)
    F.save_png(icon_full.convert("RGB"), out / "icon.png")
    F.save_png(bg.convert("RGB"), out / "android-icon-background.png")
    F.save_png(fg, out / "android-icon-foreground.png")
    F.save_png(fg, out / "splash-icon.png")  # Android 12+ : découpé dans un cercle de 2/3, le logo y tient
    F.save_png(mono(1024, 0.68), out / "android-icon-monochrome.png")
    F.save_png(mono(96, 0.9), out / "notification-icon.png")
    if out == MOB:
        F.save_png(down(F.render([F.svg(variant, "icon")], 1024)[0], 48), out / "favicon.png")


def main():
    rnd = dict(PROD, shape="circle")
    maskable = dict(PROD)
    icon, full, fg, rnd_img = F.render([F.svg(PROD, "icon"), F.svg(PROD, "full"), F.svg(PROD, "foreground"),
                                        F.svg(rnd, "icon")], 1024)
    # Masquable (PWA) : fond plein, logo dans la zone sûre (cercle de 80 %) comme l'avant-plan Android.
    mask_bg = F.render([F.svg(maskable, "background")], 1024)[0]
    mask_bg.alpha_composite(fg)
    frames = F.render_palettes(frame_palettes(PROD), "icon", 256)
    desktop(icon, full, fg, rnd_img, frames)
    web(icon, full, mask_bg, frames)
    mobile(PROD, MOB)
    mobile(DEV, MOB / "dev")
    print("icônes principales régénérées")


if __name__ == "__main__":
    main()
