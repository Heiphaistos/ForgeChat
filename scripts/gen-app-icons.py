"""Génère les icônes d'application prédéfinies (client/public/app-icons/1..N.png).

Coloris du logo 3D (scripts/forgelogo.py) rangés par familles : signature, métaux, néon,
pastel, sombre, clair, verre, holographique, matières, espace, saisons, fiertés, monochrome,
rétro pixel, plat minimal, ronds. Sortie 128 × 128 (barre des tâches, zone de notification,
favicon), PNG à palette réduite (imagequant). Écrit aussi client/src/lib/appIconPresets.ts (familles et noms
pour l'écran de choix) et met à jour PRESET_COUNT (client/src/lib/appIcon.ts).

Le mobile reprend le même catalogue (mobile/scripts/generate-app-icons.py). Rendu par Chrome
headless (variable CHROME si besoin). Relancer après un changement du logo ou du catalogue :
    python3 scripts/gen-app-icons.py
"""
import colorsys
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # pas de scripts/__pycache__ dans le dépôt
sys.path.insert(0, str(Path(__file__).resolve().parent))
import forgelogo as F  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "client/public/app-icons"
PRESETS_TS = ROOT / "client/src/lib/appIconPresets.ts"
APP_ICON_TS = ROOT / "client/src/lib/appIcon.ts"
FINAL = 128


# ─── Outils de couleur ───────────────────────────────────────────────────────

def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex(rgb):
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02X}" for c in rgb)


def light(h, k):
    """Éclaircit (k > 0) ou assombrit (k < 0) en luminosité HLS."""
    hh, ll, ss = colorsys.rgb_to_hls(*_rgb(h))
    ll = ll + (1 - ll) * k if k > 0 else ll * (1 + k)
    return _hex(colorsys.hls_to_rgb(hh, ll, ss))


def mix(a, b, t):
    return _hex(tuple(x + (y - x) * t for x, y in zip(_rgb(a), _rgb(b))))


# ─── Familles ────────────────────────────────────────────────────────────────

def signature(a, b):
    """Logo d'origine sur un autre dégradé : face blanche, enclume teintée de la couleur principale."""
    return F.palette(bg=[light(a, 0.08), b, light(b, -0.55)], glow=light(a, 0.5), face=["#FFFFFF", light(a, 0.86)],
                     side=[light(a, 0.45), light(a, -0.15)], anvil=[light(a, 0.25), a, light(a, -0.45)],
                     shadow=light(b, -0.75))


def metal(hi, mid, lo, bg=("#3B3F4A", "#1D1F26", "#0B0C10"), anvil=None):
    """Métal poli : face en dégradé métallique à reflets, fond anthracite."""
    an = anvil or [light(lo, -0.1), light(lo, -0.35), light(lo, -0.65)]
    return F.palette(bg=list(bg), glow=mid, face=[hi, mid, hi, lo], side=[mid, light(lo, -0.4)], anvil=an,
                     shadow="#000000")


def neon(c, bg=("#120C24", "#0A0816", "#04030A")):
    return F.palette(bg=list(bg), glow=c, face=[light(c, 0.55)], side=[c, light(c, -0.5)],
                     anvil=[light(c, 0.4), c, light(c, -0.3)], finish="neon", rim=c, shadow="#000000",
                     spark=["#FFFFFF", light(c, 0.35), c])


def pastel(a, b, accent):
    return F.palette(bg=[a, b, light(b, -0.12)], glow="#FFFFFF", face=["#FFFFFF", light(a, 0.6)],
                     side=[light(accent, 0.55), light(accent, 0.15)], anvil=[light(accent, 0.3), accent, light(accent, -0.3)],
                     shadow=light(accent, -0.4), spark=["#FFFFFF", "#FDE68A", "#FBBF24"])


def dark(accent):
    return F.palette(bg=["#2E3036", "#1E1F22", "#0E0F11"], glow=accent, face=["#41444C", "#24262B"],
                     side=["#4B4F58", "#141518"], anvil=[light(accent, 0.3), accent, light(accent, -0.4)],
                     shadow="#000000", rim=light(accent, 0.4))


def bright(accent):
    return F.palette(bg=["#FFFFFF", "#EEF0F6", "#D3D8E4"], glow=light(accent, 0.7), face=["#FFFFFF", "#EEF1F7"],
                     side=["#DDE1EA", "#A3AABB"], anvil=[light(accent, 0.25), accent, light(accent, -0.4)],
                     shadow="#475569", rim="#FFFFFF")


def glass(a, b):
    return F.palette(bg=[a, b, light(b, -0.5)], glow="#FFFFFF", face=["#FFFFFF", light(a, 0.7)], finish="glass",
                     side=[light(a, 0.6), light(b, 0.1)], anvil=[light(b, 0.3), light(b, -0.15), light(b, -0.55)],
                     shadow=light(b, -0.7))


def holo(a, b, face_tint):
    return F.palette(bg=[a, b, light(b, -0.35)], glow="#FFFFFF", face=["#FFFFFF", face_tint, "#E0F7FF"],
                     side=[light(face_tint, -0.05), light(b, -0.2)], anvil=["#C4B5FD", "#818CF8", "#4338CA"],
                     texture="holo", texture_opacity=0.55, shadow=light(b, -0.7))


def textured(tex, color, op, bg, face, side, anvil, **kw):
    return F.palette(bg=bg, glow=kw.pop("glow", face[0]), face=face, side=side, anvil=anvil, texture=tex,
                     texture_color=color, texture_opacity=op, shadow=kw.pop("shadow", "#000000"), **kw)


def flag(*stripes, anvil=("#475569", "#1F2937", "#0B1220")):
    return F.palette(stripes=list(stripes), bg=[stripes[0], stripes[-1]], glow="#FFFFFF", face=["#FFFFFF", "#EEF0F6"],
                     side=["#E5E7EB", "#9CA3AF"], anvil=list(anvil), shadow="#111827")


def mono(bg, face, anvil, spark=("#FFFFFF", "#E5E7EB", "#9CA3AF"), **kw):
    return F.palette(bg=bg, glow=face[0], face=face, side=[light(face[-1], -0.1), light(face[-1], -0.45)],
                     anvil=anvil, spark=list(spark), shadow="#000000", **kw)


def flat(bg, face, anvil, spark="#FCD34D"):
    return F.palette(bg=[bg, bg], glow=bg, face=[face, face], side=[light(bg, -0.25), light(bg, -0.25)],
                     anvil=[anvil, anvil, anvil], spark=["#FFFFFF", spark, spark], finish="flat", rim=bg)


G = []  # (id, libellé, [(nom, palette)])

G.append(("signature", "Signature", [
    ("Océan", signature("#0EA5E9", "#2563EB")), ("Émeraude", signature("#10B981", "#047857")),
    ("Coucher de soleil", signature("#F59E0B", "#E11D48")), ("Rose", signature("#EC4899", "#9333EA")),
    ("Corail", signature("#FB7185", "#F97316")), ("Lagon", signature("#14B8A6", "#4F46E5")),
    ("Citron vert", signature("#84CC16", "#0D9488")), ("Cerise", signature("#E11D48", "#7F1D1D")),
    ("Ciel", signature("#38BDF8", "#6366F1")), ("Fuchsia", signature("#D946EF", "#E11D48")),
    ("Ardoise", signature("#64748B", "#1E293B")), ("Minuit", signature("#3B82F6", "#0F172A")),
    ("Menthe", signature("#34D399", "#0EA5E9")), ("Raisin", signature("#A855F7", "#4C1D95")),
    ("Ambre", signature("#FBBF24", "#B45309")), ("Indigo vif", signature("#5865F2", "#404EED")),
]))
G.append(("metal", "Métaux", [
    ("Or", metal("#FFF7D6", "#E8B730", "#8A5A0B")),
    ("Argent", metal("#FFFFFF", "#C9CED8", "#6B7280")),
    ("Bronze", metal("#FFE2C2", "#C77B3A", "#6B3A12")),
    ("Chrome", metal("#FFFFFF", "#9AA4B5", "#2D3340", bg=("#5B6475", "#262B36", "#0B0D12"))),
    ("Cuivre", metal("#FFD9C7", "#D9784E", "#7C2D12")),
    ("Or rose", metal("#FFE4E6", "#E8A0A8", "#9F4A5A")),
    ("Titane", metal("#E9EEF5", "#8D99AE", "#3D4655")),
    ("Acier bleui", metal("#E0F2FE", "#6B8CB8", "#1E3A5F")),
    ("Platine", metal("#FFFFFF", "#E2E6EE", "#9AA3B2", bg=("#1E293B", "#0F172A", "#020617"))),
    ("Laiton", metal("#FFF6C8", "#C9A227", "#6E5410", bg=("#14352B", "#0B231C", "#04110D"))),
]))
G.append(("neon", "Néon", [
    (n, neon(c)) for n, c in (
        ("Néon cyan", "#22D3EE"), ("Néon rose", "#F472B6"), ("Néon vert", "#4ADE80"), ("Néon violet", "#A78BFA"),
        ("Néon orange", "#FB923C"), ("Néon jaune", "#FACC15"), ("Néon rouge", "#F87171"), ("Néon bleu", "#60A5FA"),
        ("Néon menthe", "#2DD4BF"), ("Néon blanc", "#E5E7EB"),
    )
]))
G.append(("pastel", "Pastel", [
    ("Barbe à papa", pastel("#FBCFE8", "#C4B5FD", "#8B5CF6")), ("Lavande", pastel("#E9D5FF", "#C7D2FE", "#6366F1")),
    ("Pêche", pastel("#FED7AA", "#FBCFE8", "#F97316")), ("Menthe douce", pastel("#BBF7D0", "#A5F3FC", "#0D9488")),
    ("Bleuet", pastel("#BFDBFE", "#DDD6FE", "#3B82F6")), ("Vanille", pastel("#FEF3C7", "#FED7AA", "#D97706")),
    ("Pistache", pastel("#D9F99D", "#BBF7D0", "#65A30D")), ("Lilas", pastel("#F5D0FE", "#E9D5FF", "#A21CAF")),
    ("Aube", pastel("#FECDD3", "#FDE68A", "#E11D48")), ("Nuage", pastel("#E0F2FE", "#F1F5F9", "#0284C7")),
    ("Sorbet", pastel("#FDA4AF", "#FDBA74", "#BE123C")), ("Lagune", pastel("#99F6E4", "#BAE6FD", "#0F766E")),
]))
G.append(("dark", "Sombre", [
    (n, dark(c)) for n, c in (
        ("Nuit indigo", "#6366F1"), ("Nuit bleue", "#3B82F6"), ("Nuit verte", "#22C55E"), ("Nuit rouge", "#EF4444"),
        ("Nuit orange", "#F97316"), ("Nuit dorée", "#EAB308"), ("Nuit rose", "#EC4899"), ("Nuit violette", "#A855F7"),
        ("Nuit turquoise", "#14B8A6"), ("Nuit blanche", "#E5E7EB"),
    )
]))
G.append(("light", "Clair", [
    (n, bright(c)) for n, c in (
        ("Jour indigo", "#5865F2"), ("Jour bleu", "#2563EB"), ("Jour vert", "#16A34A"), ("Jour rouge", "#DC2626"),
        ("Jour orange", "#EA580C"), ("Jour rose", "#DB2777"), ("Jour violet", "#7C3AED"), ("Jour encre", "#0F172A"),
        ("Jour turquoise", "#0D9488"), ("Jour doré", "#CA8A04"),
    )
]))
G.append(("glass", "Verre", [
    ("Verre bleu", glass("#60A5FA", "#1D4ED8")), ("Verre violet", glass("#C084FC", "#6D28D9")),
    ("Verre vert", glass("#4ADE80", "#047857")), ("Verre rose", glass("#F9A8D4", "#BE185D")),
    ("Verre ambre", glass("#FCD34D", "#C2410C")), ("Verre glacier", glass("#A5F3FC", "#0E7490")),
    ("Verre fumé", glass("#94A3B8", "#1E293B")), ("Verre aurore", glass("#F0ABFC", "#0EA5E9")),
]))
G.append(("holo", "Holographique", [
    ("Holo iris", holo("#C4B5FD", "#7C3AED", "#FCE7F3")), ("Holo opale", holo("#A5F3FC", "#6366F1", "#ECFEFF")),
    ("Holo nacre", holo("#FBCFE8", "#A78BFA", "#FDF4FF")), ("Holo prisme", holo("#FDE68A", "#EC4899", "#FFF7ED")),
    ("Holo aurore", holo("#86EFAC", "#3B82F6", "#F0FDF4")), ("Holo nuit", holo("#6366F1", "#1E1B4B", "#E0E7FF")),
]))
G.append(("matter", "Matières", [
    ("Chêne", textured("wood", "#3B1F0E", 0.55, ["#C68A4E", "#9A5B2C", "#5B3216"], ["#FFF7ED", "#FDE7C8"],
                       ["#D6A574", "#7C4A21"], ["#B07040", "#7A4520", "#40200A"], glow="#FCD9A8")),
    ("Noyer", textured("wood", "#1C0E05", 0.6, ["#7A4A2A", "#55301A", "#2A160A"], ["#FDF2E4", "#EED6B8"],
                       ["#B98B5E", "#5A3518"], ["#8C5530", "#5E3519", "#2B1406"], glow="#E9B98A")),
    ("Bouleau", textured("wood", "#8A6A45", 0.35, ["#F2DDB9", "#DDBF8F", "#B8955F"], ["#FFFFFF", "#FAF3E6"],
                         ["#E8D3B0", "#A8875A"], ["#C79A5B", "#8E6A38", "#5A4120"], glow="#FFFFFF", shadow="#5A4120")),
    ("Marbre blanc", textured("marble", "#6B7280", 0.45, ["#FFFFFF", "#E5E7EB", "#C7CBD3"], ["#FFFFFF", "#F3F4F6"],
                              ["#E5E7EB", "#9CA3AF"], ["#D4AF37", "#A67C1A", "#5F450B"], glow="#FFFFFF", shadow="#374151")),
    ("Marbre noir", textured("marble", "#E5E7EB", 0.4, ["#2A2D33", "#14161A", "#050506"], ["#FFFFFF", "#E5E7EB"],
                             ["#9CA3AF", "#374151"], ["#F0D27A", "#C9A227", "#6E5410"], glow="#9CA3AF")),
    ("Marbre vert", textured("marble", "#D1FAE5", 0.4, ["#0F5132", "#073B24", "#022314"], ["#FFFFFF", "#ECFDF5"],
                             ["#A7F3D0", "#065F46"], ["#E8C468", "#B08A26", "#5E4710"], glow="#6EE7B7")),
    ("Lave", textured("lava", "#FDE047", 0.55, ["#F97316", "#B91C1C", "#1C0A05"], ["#FFF7ED", "#FED7AA"],
                      ["#FB923C", "#7C2D12"], ["#3F3F46", "#27272A", "#09090B"], glow="#FB923C",
                      spark=["#FFFFFF", "#FDE047", "#F97316"])),
    ("Magma", textured("lava", "#F97316", 0.6, ["#3F0D0D", "#1C0606", "#000000"], ["#FED7AA", "#FB923C"],
                       ["#EA580C", "#431407"], ["#52525B", "#27272A", "#09090B"], glow="#EA580C",
                       spark=["#FFFFFF", "#FDE047", "#F97316"])),
    ("Glace", textured("frost", "#FFFFFF", 0.45, ["#BAE6FD", "#38BDF8", "#0C4A6E"], ["#FFFFFF", "#E0F2FE"],
                       ["#BAE6FD", "#0369A1"], ["#7DD3FC", "#0284C7", "#0C4A6E"], glow="#E0F2FE",
                       spark=["#FFFFFF", "#E0F2FE", "#7DD3FC"])),
    ("Givre", textured("frost", "#FFFFFF", 0.6, ["#E0F2FE", "#A5B4FC", "#4C51BF"], ["#FFFFFF", "#EEF2FF"],
                       ["#C7D2FE", "#4338CA"], ["#A5B4FC", "#6366F1", "#312E81"], glow="#FFFFFF",
                       spark=["#FFFFFF", "#E0E7FF", "#A5B4FC"])),
    ("Béton", textured("noise", "#000000", 0.25, ["#A8A29E", "#78716C", "#44403C"], ["#FAFAF9", "#E7E5E4"],
                       ["#D6D3D1", "#57534E"], ["#F97316", "#C2410C", "#7C2D12"], glow="#E7E5E4")),
    ("Carbone", textured("grid", "#FFFFFF", 0.06, ["#27272A", "#18181B", "#030303"], ["#3F3F46", "#18181B"],
                         ["#52525B", "#09090B"], ["#EF4444", "#B91C1C", "#450A0A"], glow="#71717A")),
]))
G.append(("space", "Espace", [
    ("Galaxie", textured("stars", "#FFFFFF", 0.9, ["#4C1D95", "#1E1B4B", "#020617"], ["#FFFFFF", "#E0E7FF"],
                         ["#A5B4FC", "#3730A3"], ["#C084FC", "#7C3AED", "#3B0764"], glow="#A78BFA")),
    ("Nébuleuse", textured("stars", "#FFFFFF", 0.9, ["#BE185D", "#581C87", "#0B0420"], ["#FFFFFF", "#FCE7F3"],
                           ["#F9A8D4", "#831843"], ["#F472B6", "#BE185D", "#500724"], glow="#F0ABFC")),
    ("Voie lactée", textured("stars", "#FFFFFF", 0.95, ["#1E3A8A", "#0F172A", "#000000"], ["#FFFFFF", "#DBEAFE"],
                             ["#93C5FD", "#1E3A8A"], ["#60A5FA", "#2563EB", "#172554"], glow="#93C5FD")),
    ("Aurore boréale", textured("stars", "#FFFFFF", 0.8, ["#10B981", "#0E7490", "#020617"], ["#FFFFFF", "#D1FAE5"],
                                ["#6EE7B7", "#065F46"], ["#34D399", "#059669", "#022C22"], glow="#6EE7B7")),
    ("Supernova", textured("stars", "#FFF7ED", 0.85, ["#F59E0B", "#9A3412", "#1C0A00"], ["#FFFFFF", "#FFEDD5"],
                           ["#FDBA74", "#9A3412"], ["#FB923C", "#C2410C", "#431407"], glow="#FDBA74")),
    ("Trou noir", textured("stars", "#C7D2FE", 0.7, ["#18181B", "#09090B", "#000000"], ["#27272A", "#09090B"],
                           ["#3F3F46", "#000000"], ["#A5B4FC", "#6366F1", "#312E81"], glow="#6366F1")),
]))
G.append(("season", "Saisons et fêtes", [
    ("Printemps", pastel("#BBF7D0", "#FBCFE8", "#16A34A")),
    ("Été", signature("#FACC15", "#F97316")),
    ("Automne", signature("#EA580C", "#7C2D12")),
    ("Hiver", textured("frost", "#FFFFFF", 0.5, ["#DBEAFE", "#93C5FD", "#1E3A8A"], ["#FFFFFF", "#EFF6FF"],
                       ["#BFDBFE", "#1D4ED8"], ["#93C5FD", "#3B82F6", "#1E3A8A"], glow="#FFFFFF",
                       spark=["#FFFFFF", "#DBEAFE", "#93C5FD"])),
    ("Halloween", F.palette(bg=["#F97316", "#7C2D12", "#1C0A00"], glow="#FB923C", face=["#1F1F1F", "#0A0A0A"],
                            side=["#3F3F46", "#000000"], anvil=["#FDBA74", "#F97316", "#9A3412"], shadow="#000000",
                            spark=["#FFFFFF", "#A3E635", "#65A30D"])),
    ("Noël", F.palette(bg=["#DC2626", "#991B1B", "#450A0A"], glow="#FCA5A5", face=["#FFFFFF", "#FEE2E2"],
                       side=["#FECACA", "#B91C1C"], anvil=["#4ADE80", "#15803D", "#052E16"], shadow="#2A0505")),
    ("Saint-Valentin", signature("#F472B6", "#BE123C")),
    ("Pâques", pastel("#FEF08A", "#C7D2FE", "#8B5CF6")),
    ("Nouvel An", metal("#FFF7D6", "#E8B730", "#8A5A0B", bg=("#1E1B4B", "#0F0A2E", "#020014"))),
    ("Carnaval", signature("#A855F7", "#F59E0B")),
]))
G.append(("pride", "Fiertés", [
    ("Arc-en-ciel", flag("#E40303", "#FF8C00", "#FFED00", "#008026", "#004DFF", "#750787")),
    ("Trans", flag("#5BCEFA", "#F5A9B8", "#FFFFFF", "#F5A9B8", "#5BCEFA", anvil=("#F5A9B8", "#E0709A", "#8A2E52"))),
    ("Bi", flag("#D60270", "#D60270", "#9B4F96", "#0038A8", "#0038A8")),
    ("Pan", flag("#FF218C", "#FFD800", "#21B1FF")),
    ("Lesbienne", flag("#D52D00", "#FF9A56", "#FFFFFF", "#D362A4", "#A30262")),
    ("Non binaire", flag("#FCF434", "#FFFFFF", "#9C59D1", "#2C2C2C", anvil=("#C4A1E8", "#9C59D1", "#4A2270"))),
    ("Asexuel", flag("#000000", "#A3A3A3", "#FFFFFF", "#800080", anvil=("#B565B5", "#800080", "#3D003D"))),
    ("Intersexe", F.palette(bg=["#FFD800", "#FFC400"], glow="#FFFFFF", face=["#FFFFFF", "#FEF9C3"],
                            side=["#FDE68A", "#A16207"], anvil=["#B45AD6", "#7902AA", "#3B0055"], shadow="#713F12")),
]))
G.append(("mono", "Monochrome", [
    ("Encre", mono(["#3F3F46", "#18181B", "#000000"], ["#FFFFFF", "#D4D4D8"], ["#52525B", "#27272A", "#09090B"])),
    ("Papier", mono(["#FFFFFF", "#F4F4F5", "#D4D4D8"], ["#FFFFFF", "#F4F4F5"], ["#3F3F46", "#18181B", "#000000"],
                    spark=("#FFFFFF", "#A1A1AA", "#52525B"))),
    ("Graphite", mono(["#71717A", "#3F3F46", "#18181B"], ["#E4E4E7", "#A1A1AA"], ["#3F3F46", "#27272A", "#09090B"])),
    ("Sépia", mono(["#A47551", "#6F4E37", "#3B2A1E"], ["#FBF3E6", "#E8D5B9"], ["#8B6B4A", "#5C4430", "#2E2117"],
                   spark=("#FFFFFF", "#F3E3C8", "#C8A675"))),
    ("Noir et or", mono(["#27272A", "#0A0A0A", "#000000"], ["#1F1F1F", "#0A0A0A"], ["#F0D27A", "#C9A227", "#6E5410"],
                        spark=("#FFFFFF", "#F0D27A", "#C9A227"))),
    ("Bleu nuit", mono(["#1E3A8A", "#172554", "#020617"], ["#DBEAFE", "#93C5FD"], ["#1E40AF", "#172554", "#020617"],
                       spark=("#FFFFFF", "#DBEAFE", "#93C5FD"))),
    ("Rouge", mono(["#DC2626", "#991B1B", "#450A0A"], ["#FFFFFF", "#FECACA"], ["#B91C1C", "#7F1D1D", "#450A0A"],
                   spark=("#FFFFFF", "#FECACA", "#F87171"))),
    ("Vert forêt", mono(["#166534", "#14532D", "#052E16"], ["#DCFCE7", "#86EFAC"], ["#15803D", "#14532D", "#052E16"],
                        spark=("#FFFFFF", "#DCFCE7", "#86EFAC"))),
]))


def _pixel(p, n=28):
    p = dict(p)
    p["pixel"] = n
    return p


G.append(("pixel", "Rétro pixel", [
    ("Pixel classique", _pixel(F.palette())), ("Pixel arcade", _pixel(neon("#F472B6"))),
    ("Pixel Game Boy", _pixel(mono(["#9BBC0F", "#8BAC0F", "#306230"], ["#9BBC0F", "#8BAC0F"],
                                   ["#306230", "#0F380F", "#0F380F"], spark=("#E0F8D0", "#9BBC0F", "#306230")), 24)),
    ("Pixel océan", _pixel(signature("#0EA5E9", "#2563EB"))), ("Pixel lave", _pixel(signature("#F97316", "#B91C1C"))),
    ("Pixel forêt", _pixel(signature("#22C55E", "#166534"))), ("Pixel or", _pixel(metal("#FFF7D6", "#E8B730", "#8A5A0B"))),
    ("Pixel nuit", _pixel(dark("#A855F7"))), ("Pixel 8 bits", _pixel(F.palette(), 20)),
    ("Pixel bonbon", _pixel(pastel("#FBCFE8", "#C4B5FD", "#8B5CF6"))),
]))
G.append(("flat", "Plat minimal", [
    ("Plat indigo", flat("#5865F2", "#FFFFFF", "#5865F2")), ("Plat noir", flat("#111827", "#FFFFFF", "#111827")),
    ("Plat blanc", flat("#FFFFFF", "#5865F2", "#FFFFFF", "#F59E0B")), ("Plat rouge", flat("#EF4444", "#FFFFFF", "#EF4444")),
    ("Plat vert", flat("#22C55E", "#FFFFFF", "#15803D")), ("Plat bleu", flat("#2563EB", "#FFFFFF", "#1D4ED8")),
    ("Plat orange", flat("#F97316", "#FFFFFF", "#C2410C", "#FDE047")), ("Plat rose", flat("#EC4899", "#FFFFFF", "#BE185D")),
    ("Plat jaune", flat("#FACC15", "#1F2937", "#FACC15", "#FFFFFF")), ("Plat turquoise", flat("#14B8A6", "#FFFFFF", "#0F766E")),
    ("Plat violet", flat("#7C3AED", "#FFFFFF", "#6D28D9")), ("Plat ardoise", flat("#334155", "#E2E8F0", "#334155")),
]))


def _round(p):
    p = dict(p)
    p["shape"] = "circle"
    return p


G.append(("round", "Ronds", [
    ("Rond indigo", _round(F.palette())), ("Rond océan", _round(signature("#0EA5E9", "#2563EB"))),
    ("Rond émeraude", _round(signature("#10B981", "#047857"))), ("Rond soleil", _round(signature("#F59E0B", "#E11D48"))),
    ("Rond or", _round(metal("#FFF7D6", "#E8B730", "#8A5A0B"))), ("Rond néon", _round(neon("#22D3EE"))),
    ("Rond nuit", _round(dark("#6366F1"))), ("Rond galaxie", _round(G[9][2][0][1])),
]))


def presets():
    """[(n, famille, nom, palette)], numérotés à partir de 1 dans l'ordre du catalogue."""
    out = []
    for gid, _, items in G:
        for name, p in items:
            out.append((len(out) + 1, gid, name, p))
    return out


def write_ts(items):
    lines = [
        "// Généré par scripts/gen-app-icons.py : ne pas modifier à la main.",
        "// Familles et noms des icônes prédéfinies (public/app-icons/N.png), pour l'écran de choix.",
        "",
        "export interface PresetGroup { id: string; label: string; presets: { n: number; name: string }[] }",
        "",
        "export const PRESET_GROUPS: PresetGroup[] = [",
    ]
    for gid, label, _ in G:
        members = ", ".join(f"{{ n: {n}, name: '{name}' }}" for n, g, name, _ in items if g == gid)
        lines.append(f"  {{ id: '{gid}', label: '{label}', presets: [{members}] }},")
    lines += ["]", ""]
    PRESETS_TS.write_text("\n".join(lines), encoding="utf-8")
    src = APP_ICON_TS.read_text(encoding="utf-8")
    APP_ICON_TS.write_text(re.sub(r"PRESET_COUNT = \d+", f"PRESET_COUNT = {len(items)}", src), encoding="utf-8")


def main():
    items = presets()
    assert len(items) >= 150, len(items)
    imgs = F.render_palettes([p for *_, p in items], "icon", 512)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    for (n, *_), img in zip(items, imgs):
        F.save_png(img.resize((FINAL, FINAL), F.Image.LANCZOS), OUT / f"{n}.png", quantize=True)
    write_ts(items)
    print(f"{len(items)} icônes -> {OUT}")


if __name__ == "__main__":
    main()
