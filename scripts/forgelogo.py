"""Logo ForgeChat en 3D (bulle de chat extrudée, enclume embossée, étincelle de forge).

Module partagé par les générateurs d'icônes (pas un script) :
  scripts/gen-brand-icons.py          icône principale de toutes les plateformes ;
  scripts/gen-app-icons.py            icônes prédéfinies du web et du bureau ;
  mobile/scripts/generate-app-icons.py icônes alternatives du mobile.

Le dessin est un SVG procédural (dégradés, biseau par feSpecularLighting, ombres floues,
reflet, liseré de lumière) dans un carré de 1024 unités ; `palette()` décrit les couleurs et
la matière, `svg()` assemble le logo pour un usage donné. Le rendu passe par Chrome headless
(rendu SVG fidèle, filtres compris) : plusieurs SVG par capture, découpés ensuite avec Pillow.
"""
import base64
import glob
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

# ─── Géométrie (unités du carré de 1024) ─────────────────────────────────────

# Bulle de chat : rectangle très arrondi, queue en bas à gauche.
BUBBLE = (
    "M 318 236 L 706 236 C 790 236 840 286 840 370 L 840 586 C 840 670 790 720 706 720 "
    "L 452 720 L 316 828 C 300 840 284 830 290 812 L 318 720 "
    "C 234 720 184 670 184 586 L 184 370 C 184 286 234 236 318 236 Z"
)
DEPTH = 34  # épaisseur de l'extrusion (vers le bas)
# Enclume de profil, sur la face de la bulle : corne à gauche, table, taille, pied.
def _place(path, k, cx, cy, tx, ty):
    """Met à l'échelle `k` autour de (cx, cy) puis centre en (tx, ty) (chemins en coordonnées absolues)."""
    out, nums = [], []
    for tok in path.split():
        try:
            nums.append(float(tok))
        except ValueError:
            out.append(tok)
            continue
        if len(nums) == 2:
            x, y = nums
            out.append(f"{tx + (x - cx) * k:.1f} {ty + (y - cy) * k:.1f}")
            nums = []
    return " ".join(out)


ANVIL = (
    "M 300 392 L 662 392 C 676 392 684 400 684 414 L 684 438 C 684 452 676 460 662 460 "
    "L 614 460 C 594 476 588 500 596 522 L 640 522 C 654 522 662 532 662 544 L 662 566 "
    "C 662 578 654 586 640 586 L 400 586 C 386 586 378 578 378 566 L 378 544 "
    "C 378 532 386 522 400 522 L 444 522 C 452 500 446 476 426 462 "
    "C 380 460 330 446 286 420 C 270 410 280 392 300 392 Z"
)
ANVIL_TOP = "M 300 392 L 662 392 C 676 392 684 400 684 414 L 684 420 L 288 420 C 282 404 288 392 300 392 Z"
# Dessinée autour de (482, 489) ; agrandie et centrée sur la face de la bulle.
ANVIL, ANVIL_TOP = (_place(a, 1.12, 482, 489, 514, 484) for a in (ANVIL, ANVIL_TOP))
SPARK_AT = (722, 314)  # point de frappe : coin haut droit de la table, sur le bord de la bulle


def star(cx, cy, r, inner=0.22, rot=0.0):
    """Étoile à 4 branches effilées (éclat d'étincelle)."""
    pts = []
    for i in range(8):
        a = rot + i * math.pi / 4
        rr = r if i % 2 == 0 else r * inner
        pts.append(f"{cx + rr * math.sin(a):.1f} {cy - rr * math.cos(a):.1f}")
    return "M " + " L ".join(pts) + " Z"


# ─── Palettes ────────────────────────────────────────────────────────────────

BASE = {
    "bg": ["#4F46E5", "#7C3AED", "#2E1065"],   # dégradé du fond (haut gauche → bas droite, fond)
    "glow": "#A5B4FC",                         # halo derrière la bulle
    "face": ["#FFFFFF", "#E0E7FF"],            # face avant de la bulle (haut → bas)
    "side": ["#A5B4FC", "#4338CA"],            # tranche de l'extrusion
    "anvil": ["#818CF8", "#4F46E5", "#312E81"],  # enclume (lumière, milieu, ombre)
    "spark": ["#FFFBEB", "#FCD34D", "#F59E0B"],  # étincelle (cœur, éclat, bord)
    "rim": "#FFFFFF",                          # liseré de lumière du fond
    "shadow": "#1E1B4B",                       # ombre portée
    "finish": "gloss",                         # gloss | flat | glass | neon | outline
    "texture": None,                           # None | noise | stars | marble | wood | grid | holo
    "texture_color": "#FFFFFF",
    "texture_opacity": 0.0,
    "shape": "squircle",                       # squircle | circle
    "stripes": None,                           # bandes de couleur du fond (drapeaux), sinon dégradé
    "base": "#1E1F22",                         # autour du disque, en icône opaque (gris de l'app)
    "pixel": 0,                                # > 0 : rendu pixelisé sur une grille de N (rétro)
}


def palette(**over):
    p = dict(BASE)
    p.update(over)
    return p


def _grad(id_, colors, x1=0, y1=0, x2=1, y2=1, opacity=None):
    n = len(colors)
    stops = "".join(
        f'<stop offset="{i / (n - 1) if n > 1 else 0:.3f}" stop-color="{c}"'
        + (f' stop-opacity="{opacity[i]}"' if opacity else "") + "/>"
        for i, c in enumerate(colors)
    )
    return f'<linearGradient id="{id_}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{stops}</linearGradient>'


def _texture(p, clip):
    """Matière du fond (bruit, étoiles, marbre, bois, grille, holographique) par feTurbulence."""
    t, op, col = p["texture"], p["texture_opacity"], p["texture_color"]
    if not t or op <= 0:
        return "", ""
    if t == "stars":
        import random
        rnd = random.Random(7)
        dots = "".join(
            f'<circle cx="{rnd.uniform(40, 984):.0f}" cy="{rnd.uniform(40, 984):.0f}" r="{rnd.choice([2, 2, 3, 4, 5]):d}" '
            f'fill="{col}" opacity="{rnd.uniform(0.35, 1):.2f}"/>' for _ in range(70)
        )
        neb = (f'<filter id="neb" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.004" '
               f'numOctaves="3" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.55  0 0 0 0 0.95  0 0 0 1.4 -0.55"/></filter>')
        return neb, f'<g clip-path="url(#{clip})" opacity="{op}"><rect width="1024" height="1024" filter="url(#neb)"/>{dots}</g>'
    if t == "grid":
        lines = "".join(f'<path d="M {x} 0 V 1024 M 0 {x} H 1024" stroke="{col}" stroke-width="3"/>' for x in range(64, 1024, 64))
        return "", f'<g clip-path="url(#{clip})" opacity="{op}">{lines}</g>'
    if t == "holo":
        g = _grad("holo", ["#FF7AD9", "#7AE7FF", "#B9FF7A", "#FFE27A", "#C77AFF"], 0, 0, 1, 0.6)
        return g, f'<rect width="1024" height="1024" fill="url(#holo)" clip-path="url(#{clip})" opacity="{op}" style="mix-blend-mode:screen"/>'
    freq, oct_, kind = {
        "noise": ("0.9", 2, "fractalNoise"),
        "marble": ("0.006 0.012", 4, "turbulence"),
        "wood": ("0.004 0.06", 3, "fractalNoise"),
        "lava": ("0.008", 4, "turbulence"),
        "frost": ("0.03", 3, "fractalNoise"),
    }[t]
    # Bruit → alpha (luminance), teint d'une couleur unie : la matière éclaircit ou assombrit le fond.
    filt = (f'<filter id="tex" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">'
            f'<feTurbulence type="{kind}" baseFrequency="{freq}" numOctaves="{oct_}" seed="11" result="n"/>'
            f'<feColorMatrix in="n" type="luminanceToAlpha" result="a"/>'
            f'<feComponentTransfer in="a" result="a2"><feFuncA type="table" tableValues="0 0.15 0.85 1"/></feComponentTransfer>'
            f'<feFlood flood-color="{col}" result="c"/><feComposite in="c" in2="a2" operator="in"/></filter>')
    return filt, f'<rect width="1024" height="1024" filter="url(#tex)" clip-path="url(#{clip})" opacity="{op}"/>'


def art(p, with_bg=True, opaque=False, logo=True):
    """Contenu du SVG (sans la balise <svg>) : fond, ombres, bulle 3D, enclume, étincelle."""
    fin = p["finish"]
    flat = fin == "flat"
    bg = p["bg"]
    d = []  # defs
    b = []  # corps
    # Fond : carré arrondi (icône), disque, ou carré plein (iOS, opaque ; le disque est alors posé
    # sur le gris de l'app).
    circle = p["shape"] == "circle"
    if circle:
        shape = '<circle cx="512" cy="512" r="496"/>' if not opaque else '<circle cx="512" cy="512" r="480"/>'
    elif opaque:
        shape = '<rect width="1024" height="1024"/>'
    else:
        shape = '<rect x="0" y="0" width="1024" height="1024" rx="232"/>'
    d.append(f'<clipPath id="bgclip">{shape}</clipPath>')
    if p.get("stripes"):
        # Bandes horizontales franches (drapeaux).
        n = len(p["stripes"])
        stops = "".join(f'<stop offset="{i / n:.4f}" stop-color="{c}"/><stop offset="{(i + 1) / n:.4f}" stop-color="{c}"/>'
                        for i, c in enumerate(p["stripes"]))
        d.append(f'<linearGradient id="bgg" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient>')
    else:
        d.append(_grad("bgg", bg))
    d.append(f'<radialGradient id="bghi" cx="0.28" cy="0.18" r="0.75"><stop offset="0" stop-color="#FFFFFF" stop-opacity="{0 if flat else 0.32}"/>'
             '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>')
    d.append(f'<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="{p["glow"]}" stop-opacity="0.75"/>'
             f'<stop offset="1" stop-color="{p["glow"]}" stop-opacity="0"/></radialGradient>')
    d.append(_grad("rim", [p["rim"], p["rim"], p["rim"]], 0, 0, 0.4, 1, opacity=[0.75, 0.12, 0.0]))
    tex_defs, tex_body = _texture(p, "bgclip")
    d.append(tex_defs)
    if with_bg:
        if opaque and circle:
            b.append(f'<rect width="1024" height="1024" fill="{p["base"]}"/>')
        b.append(f'<g clip-path="url(#bgclip)"><rect width="1024" height="1024" fill="url(#bgg)"/>'
                 f'<rect width="1024" height="1024" fill="url(#bghi)"/></g>')
        b.append(tex_body)
        if not flat:
            # Vignettage bas et liseré de lumière (rim light) sur le bord du fond.
            d.append('<radialGradient id="vig" cx="0.5" cy="0.35" r="0.85"><stop offset="0.6" stop-color="#000" stop-opacity="0"/>'
                     '<stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>')
            b.append('<rect width="1024" height="1024" fill="url(#vig)" clip-path="url(#bgclip)"/>')
            if not opaque or circle:
                inner = shape.replace("/>", ' fill="none" stroke="url(#rim)" stroke-width="10"/>')
                b.append(f'<g clip-path="url(#bgclip)">{inner}</g>')
        b.append('<ellipse cx="512" cy="480" rx="380" ry="320" fill="url(#glow)"/>' if not flat else "")
    if not logo:
        return "<defs>" + "".join(d) + "</defs>" + "".join(b)

    # Filtres : ombre portée floue, biseau brillant (éclairage spéculaire), lueur de l'étincelle.
    d.append('<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="26"/></filter>')
    d.append('<filter id="blur8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>')
    d.append('<filter id="sglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="22"/></filter>')
    d.append(
        '<filter id="bevel" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">'
        '<feGaussianBlur in="SourceAlpha" stdDeviation="16" result="b"/>'
        '<feSpecularLighting in="b" surfaceScale="9" specularConstant="0.95" specularExponent="22" lighting-color="#FFFFFF" result="s">'
        '<fePointLight x="250" y="-220" z="520"/></feSpecularLighting>'
        '<feComposite in="s" in2="SourceAlpha" operator="in" result="si"/>'
        '<feComposite in="SourceGraphic" in2="si" operator="arithmetic" k1="0" k2="1" k3="0.55" k4="0"/></filter>'
    )
    d.append(
        '<filter id="bevel2" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">'
        '<feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/>'
        '<feSpecularLighting in="b" surfaceScale="5" specularConstant="1.1" specularExponent="18" lighting-color="#FFFFFF" result="s">'
        '<fePointLight x="300" y="-100" z="420"/></feSpecularLighting>'
        '<feComposite in="s" in2="SourceAlpha" operator="in" result="si"/>'
        '<feComposite in="SourceGraphic" in2="si" operator="arithmetic" k1="0" k2="1" k3="0.7" k4="0"/></filter>'
    )
    d.append(_grad("face", p["face"], 0, 0, 0.2, 1))
    d.append(_grad("side", p["side"], 0, 0, 0, 1))
    d.append(_grad("anv", p["anvil"], 0, 0, 0.15, 1))
    d.append(_grad("gloss", ["#FFFFFF", "#FFFFFF"], 0, 0, 0, 1, opacity=[0.75 if fin != "glass" else 0.5, 0.0]))
    d.append(f'<radialGradient id="sp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="{p["spark"][0]}"/>'
             f'<stop offset="0.45" stop-color="{p["spark"][1]}"/><stop offset="1" stop-color="{p["spark"][2]}"/></radialGradient>')
    d.append(f'<clipPath id="bub"><path d="{BUBBLE}"/></clipPath>')

    sx, sy = SPARK_AT
    face_op = {"glass": 0.55, "neon": 0.0, "outline": 0.0}.get(fin, 1.0)
    if fin in ("neon", "outline"):
        # Néon / contour : bulle et enclume en traits lumineux, sans volume plein.
        stroke = p["face"][0]
        b.append(f'<path d="{BUBBLE}" fill="none" stroke="{p["glow"]}" stroke-width="40" opacity="0.55" filter="url(#blur8)"/>')
        b.append(f'<path d="{BUBBLE}" fill="{p["side"][1]}" fill-opacity="0.25" stroke="{stroke}" stroke-width="26" stroke-linejoin="round"/>')
        b.append(f'<path d="{ANVIL}" fill="{p["anvil"][0]}" opacity="0.6" filter="url(#blur8)"/>')
        b.append(f'<path d="{ANVIL}" fill="url(#anv)"/>')
    else:
        # Ombre portée, tranche (extrusion), face avant biseautée, reflet, enclume embossée.
        if not flat:
            b.append(f'<path d="{BUBBLE}" transform="translate(10 70)" fill="{p["shadow"]}" opacity="0.55" filter="url(#soft)"/>')
        b.append(f'<path d="{BUBBLE}" transform="translate(0 {DEPTH})" fill="url(#side)" opacity="{min(1, face_op + 0.3)}"/>')
        for k in range(1, DEPTH, 6):
            b.append(f'<path d="{BUBBLE}" transform="translate(0 {k})" fill="url(#side)" opacity="{min(1, face_op + 0.3)}"/>')
        b.append(f'<path d="{BUBBLE}" fill="url(#face)" opacity="{face_op}"' + ('' if flat else ' filter="url(#bevel)"') + '/>')
        if not flat:
            # Ombre de l'enclume sur la face, enclume biseautée, arête claire de la table.
            b.append(f'<path d="{ANVIL}" transform="translate(6 18)" fill="{p["shadow"]}" opacity="0.35" filter="url(#blur8)" clip-path="url(#bub)"/>')
        b.append(f'<path d="{ANVIL}" fill="url(#anv)"' + ('' if flat else ' filter="url(#bevel2)"') + '/>')
        if not flat:
            b.append(f'<path d="{ANVIL_TOP}" fill="#FFFFFF" opacity="0.35"/>')
            # Reflet brillant sur le haut de la bulle.
            b.append('<g clip-path="url(#bub)"><path d="M 150 230 L 880 230 L 880 330 C 700 400 360 420 150 360 Z" fill="url(#gloss)"/></g>')
    # Balayage de lumière (animation : position donnée, ou classe CSS fc-shine animée par l'app).
    if p.get("shine") is not None and fin not in ("neon", "outline"):
        d.append(_grad("shine", ["#FFFFFF", "#FFFFFF", "#FFFFFF"], 0, 0, 1, 0, opacity=[0, 0.6, 0]))
        x = p["shine"]
        b.append(f'<g clip-path="url(#bub)"><g class="fc-shine" transform="translate({x} 0)">'
                 '<rect x="-140" y="150" width="200" height="760" fill="url(#shine)" transform="skewX(-22)"/></g></g>')
    # Étincelle : halo, éclat à 4 branches, cœur blanc, petites étincelles satellites.
    k, rot = p.get("spark_scale", 1.0), p.get("spark_rot", 0.0)
    b.append(f'<g class="fc-spark" transform="translate({sx} {sy}) rotate({rot}) scale({k}) translate({-sx} {-sy})">')
    b.append(f'<circle cx="{sx}" cy="{sy}" r="120" fill="{p["spark"][1]}" opacity="{0.35 if flat else 0.6}" filter="url(#sglow)"/>')
    b.append(f'<path d="{star(sx, sy, 118, 0.2)}" fill="url(#sp)"/>')
    b.append(f'<path d="{star(sx, sy, 62, 0.25, math.pi / 4)}" fill="{p["spark"][1]}" opacity="0.9"/>')
    b.append(f'<circle cx="{sx}" cy="{sy}" r="22" fill="{p["spark"][0]}"/></g>')
    tw = p.get("twinkle", (0.9, 0.9, 0.9))
    for i, (dx, dy, r) in enumerate(((112, -70, 16), (138, 18, 10), (60, -122, 9))):
        b.append(f'<path class="fc-twinkle fc-t{i}" d="{star(sx + dx, sy + dy, r * 2.2, 0.3)}" fill="{p["spark"][1]}" opacity="{tw[i]}"/>')
    if p.get("embers"):
        # Braises projetées par la frappe (animées par l'app, invisibles au repos).
        for i in range(6):
            b.append(f'<circle class="fc-ember fc-e{i}" cx="{sx}" cy="{sy}" r="{9 - i % 3 * 2}" fill="{p["spark"][1]}" opacity="0"/>')
    if p.get("badge"):
        # Pastille (profil de dev) : en bas à droite de la bulle.
        b.append('<rect x="560" y="700" width="300" height="124" rx="62" fill="#111827" stroke="#FFFFFF" stroke-width="10"/>'
                 f'<text x="710" y="790" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="800" '
                 f'font-size="84" fill="#FCD34D">{p["badge"]}</text>')
    return "<defs>" + "".join(d) + "</defs>" + "".join(b)


def svg(p, mode="icon", size=1024):
    """SVG complet. mode : icon (fond arrondi transparent autour), full (carré opaque, iOS),
    background (fond seul, carré opaque), foreground (logo seul centré dans le cercle de
    sécurité 66/108 d'Android), logo (logo seul, pleine taille, fond transparent)."""
    if mode == "icon":
        inner = art(p)
    elif mode == "full":
        inner = art(p, opaque=True)
    elif mode == "background":
        inner = art(p, opaque=True, logo=False)
    elif mode == "logo":
        inner = art(p, with_bg=False)
    elif mode == "foreground":
        # Le dessin (bulle + étincelles) tient dans un cercle de rayon ≈ 450 autour de (516, 524) :
        # réduit pour un rayon de 33/108 × 1024 ≈ 313.
        inner = f'<g transform="translate(512 512) scale(0.68) translate(-516 -524)">{art(p, with_bg=False)}</g>'
    else:
        raise ValueError(mode)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">'
            f"{inner}</svg>")


def mono_svg(size=1024, scale=0.68, color="#FFFFFF"):
    """Silhouette d'une seule couleur (icône à thème Android 13+, notification)."""
    sx, sy = SPARK_AT
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">'
            f'<defs><mask id="m"><rect width="1024" height="1024" fill="#fff"/>'
            f'<path d="{ANVIL}" fill="#000"/><circle cx="{sx}" cy="{sy}" r="72" fill="#000"/></mask></defs>'
            f'<g transform="translate(512 512) scale({scale}) translate(-516 -524)">'
            f'<path d="{BUBBLE}" fill="{color}" mask="url(#m)"/>'
            f'<path d="{star(sx, sy, 118, 0.2)}" fill="{color}"/></g></svg>')


# ─── Rendu (Chrome headless) ─────────────────────────────────────────────────

def chrome():
    env = os.environ.get("CHROME")
    if env:
        return env
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    for pattern in ("/opt/pw-browsers/chromium-*/chrome-linux/chrome",
                    str(Path.home() / ".cache/ms-playwright/chromium-*/chrome-linux/chrome")):
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    raise SystemExit("Chrome introuvable : définir CHROME=/chemin/vers/chrome")


def render(svgs, size, per_shot=None):
    """Rend des SVG (chaînes) en images RGBA size × size, plusieurs par capture."""
    per_shot = per_shot or max(1, min(64, (4096 // size) ** 2))
    cols = max(1, int(math.sqrt(per_shot)))
    out = []
    exe = chrome()
    with tempfile.TemporaryDirectory(prefix="fc-logo-") as tmp:
        for start in range(0, len(svgs), per_shot):
            batch = svgs[start:start + per_shot]
            rows = math.ceil(len(batch) / cols)
            ncols = min(cols, len(batch))
            imgs = "".join(
                f'<img style="position:absolute;left:{(i % ncols) * size}px;top:{(i // ncols) * size}px;width:{size}px;height:{size}px" '
                f'src="data:image/svg+xml;base64,{base64.b64encode(s.encode()).decode()}">'
                for i, s in enumerate(batch)
            )
            html = Path(tmp) / "p.html"
            html.write_text(f'<html><body style="margin:0;background:transparent">{imgs}</body></html>', encoding="utf-8")
            shot = Path(tmp) / "s.png"
            subprocess.run([
                exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
                # Marge en bas : en headless récent, la zone peinte est un peu moins haute que la fenêtre.
                "--force-device-scale-factor=1", f"--window-size={ncols * size},{rows * size + 256}",
                "--default-background-color=00000000", "--virtual-time-budget=2000",
                f"--screenshot={shot}", f"file://{html}",
            ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sheet = Image.open(shot).convert("RGBA")
            assert sheet.size[0] == ncols * size and sheet.size[1] >= rows * size, sheet.size
            for i in range(len(batch)):
                x, y = (i % ncols) * size, (i // ncols) * size
                out.append(sheet.crop((x, y, x + size, y + size)))
    return out


def render_palettes(palettes, mode, size):
    """Rend chaque palette dans le mode donné (voir svg()), pixelisation rétro comprise."""
    imgs = render([svg(p, mode) for p in palettes], size)
    out = []
    for p, img in zip(palettes, imgs):
        if p.get("pixel"):
            # Même taille de « pixel » que l'icône entière, l'avant-plan étant réduit à 68 %.
            n = round(p["pixel"] / (0.68 if mode == "foreground" else 1))
            img = img.resize((n, n), Image.BOX).resize((size, size), Image.NEAREST)
        out.append(img)
    return out


def save_png(img, path, quantize=False):
    """PNG optimisé ; `quantize` : palette de 256 couleurs par libimagequant (paquet pip
    « imagequant », taille divisée par 2 à 4, invisible en icône), sinon PNG plein."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if quantize:
        try:
            import imagequant
        except ImportError:
            imagequant = None
            print("imagequant absent (pip install imagequant) : PNG non réduits", flush=True)
        if imagequant:
            img = imagequant.quantize_pil_image(img.convert("RGBA"), dithering_level=1.0, max_colors=256)
    img.save(path, optimize=True)
