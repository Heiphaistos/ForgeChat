#!/usr/bin/env python3
"""Publie sur le VPS les applications construites par GitHub Actions (.github/workflows/applications.yml).

Lancé par forgechat-releases-sync.timer. Pour chaque famille (mobile, desktop), prend la release
GitHub la plus récente (tags mobile-vX.Y.Z / desktop-vX.Y.Z), télécharge ses fichiers, vérifie leurs
empreintes contre SHA256SUMS.txt, les copie dans /var/www/forgechat-desktop/ puis écrit, en dernier
et de façon atomique, les manifestes lus par les applications :

  latest.json   bureau (Windows, Linux, macOS) : servi par GET /api/desktop/latest
  mobile.json   Android (+ iOS pour information) : lu par l'app mobile
  altstore.json source AltStore / SideStore : mise à jour automatique de l'app iOS

Un fichier dont l'empreinte ne correspond pas fait abandonner toute la release : les manifestes
continuent de pointer vers la version précédente. Bibliothèque standard uniquement.
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request

REPO = os.environ.get("FORGECHAT_REPO", "Heiphaistos/ForgeChat")
DEST = os.environ.get("FORGECHAT_DOWNLOADS", "/var/www/forgechat-desktop")
BASE_URL = os.environ.get("FORGECHAT_DESKTOP_BASE_URL", "https://forgechat.heiphaistos.org/desktop")
MAX_SIZE = 400 * 1024 * 1024
TAG = re.compile(r"^(mobile|desktop)-v(\d+)\.(\d+)\.(\d+)$")
NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")

# Cible du manifeste bureau -> modèle du nom de fichier (voir desktop/src-tauri/src/updater.rs).
DESKTOP = {
    "windows-x86_64": "ForgeChat-Setup-v{v}.exe",
    "windows-portable": "ForgeChat-Portable-v{v}.exe",
    "linux-x86_64": "ForgeChat-v{v}-amd64.deb",
    "linux-rpm": "ForgeChat-v{v}-x86_64.rpm",
    "linux-portable": "ForgeChat-v{v}-amd64.AppImage",
    "macos": "ForgeChat-v{v}-macos.app.tar.gz",
    "macos-dmg": "ForgeChat-v{v}-macos.dmg",
}
MOBILE = {"android": "ForgeChat-{v}.apk", "ios": "ForgeChat-{v}.ipa"}


def log(msg):
    print(msg, flush=True)


def get(url, accept="application/json"):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "forgechat-releases-sync"})
    return urllib.request.urlopen(req, timeout=60)


def latest_releases():
    with get("https://api.github.com/repos/" + REPO + "/releases?per_page=30") as r:
        releases = json.load(r)
    best = {}
    for rel in releases:
        m = TAG.match(rel.get("tag_name", ""))
        if not m or rel.get("draft") or rel.get("prerelease"):
            continue
        kind, key = m.group(1), tuple(int(x) for x in m.group(2, 3, 4))
        if kind not in best or key > best[kind][0]:
            best[kind] = (key, rel)
    return {k: (".".join(map(str, v[0])), v[1]) for k, v in best.items()}


def download(url, path):
    h = hashlib.sha256()
    size = 0
    with get(url, "application/octet-stream") as r, open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            size += len(chunk)
            if size > MAX_SIZE:
                raise ValueError(url + " : fichier trop gros")
            h.update(chunk)
            f.write(chunk)
    return h.hexdigest(), size


def write_json(name, data):
    tmp = os.path.join(DEST, "." + name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(DEST, name))


def fetch_release(rel, version, wanted):
    """Télécharge et vérifie les fichiers attendus. Rend {cible: {url, sha256, size}}."""
    assets = {a["name"]: a for a in rel.get("assets", [])}
    if "SHA256SUMS.txt" not in assets:
        raise ValueError("SHA256SUMS.txt absent")
    with get(assets["SHA256SUMS.txt"]["browser_download_url"], "application/octet-stream") as r:
        sums = {}
        for line in r.read().decode().splitlines():
            parts = line.split()
            if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{64}", parts[0]):
                sums[parts[1].lstrip("*")] = parts[0]
    out = {}
    with tempfile.TemporaryDirectory(dir=DEST, prefix=".sync-") as tmp:
        for target, pattern in wanted.items():
            name = pattern.replace("{v}", version)
            if name not in assets:
                continue
            if not NAME.match(name) or name not in sums:
                raise ValueError(name + " : nom refusé ou empreinte absente de SHA256SUMS.txt")
            final = os.path.join(DEST, name)
            part = os.path.join(tmp, name)
            if os.path.exists(final):
                with open(final, "rb") as f:
                    digest = hashlib.file_digest(f, "sha256").hexdigest()
                size = os.path.getsize(final)
            else:
                digest, size = download(assets[name]["browser_download_url"], part)
            if digest != sums[name]:
                raise ValueError(name + " : empreinte " + digest + " au lieu de " + sums[name])
            if not os.path.exists(final):
                os.chmod(part, 0o644)
                os.replace(part, final)
            out[target] = {"url": name, "sha256": digest, "size": size}
            log("  " + name + " OK (" + str(size) + " octets)")
    return out


def sync_desktop(version, rel):
    platforms = fetch_release(rel, version, DESKTOP)
    if not platforms:
        raise ValueError("aucun fichier de bureau dans la release")
    write_json("latest.json", {
        "version": version,
        "notes": rel.get("body") or "",
        "pub_date": rel.get("published_at") or "",
        "platforms": platforms,
    })


def sync_mobile(version, rel):
    platforms = fetch_release(rel, version, MOBILE)
    if not platforms:
        raise ValueError("aucun fichier mobile dans la release")
    notes = rel.get("body") or ""
    date = rel.get("published_at") or ""
    for p in platforms.values():
        p["url"] = BASE_URL + "/" + p["url"]
    write_json("mobile.json", {"version": version, "notes": notes, "pub_date": date, "platforms": platforms})
    ios = platforms.get("ios")
    if ios:
        write_json("altstore.json", {
            "name": "ForgeChat",
            "identifier": "org.heiphaistos.forgechat.source",
            "subtitle": "Messagerie ForgeChat, hors App Store",
            "website": "https://forgechat.heiphaistos.org",
            "apps": [{
                "name": "ForgeChat",
                "bundleIdentifier": "org.heiphaistos.forgechat",
                "developerName": "Heiphaistos & aerwx",
                "subtitle": "Messagerie, salons vocaux et appels",
                "localizedDescription": "ForgeChat : messages, salons, appels et salons vocaux. "
                "Application mobile créée par aerwx, ForgeChat par Heiphaistos.",
                "iconURL": "https://forgechat.heiphaistos.org/icons/icon-512.png",
                "tintColor": "5865F2",
                "versions": [{
                    "version": version,
                    "date": date,
                    "localizedDescription": notes,
                    "downloadURL": ios["url"],
                    "size": ios["size"],
                    "sha256": ios["sha256"],
                    "minOSVersion": "15.1",
                }],
            }],
            "news": [],
        })


def main():
    try:
        with open(os.path.join(DEST, ".sync-state.json"), encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}
    failed = False
    for kind, (version, rel) in latest_releases().items():
        tag = rel["tag_name"]
        if state.get(kind) == tag:
            continue
        log(tag + " : publication")
        try:
            (sync_desktop if kind == "desktop" else sync_mobile)(version, rel)
        except Exception as e:  # une release défectueuse ne doit pas bloquer l'autre famille
            log(tag + " : ABANDON (" + str(e) + ")")
            failed = True
            continue
        state[kind] = tag
        write_json(".sync-state.json", state)
        log(tag + " : en ligne")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
