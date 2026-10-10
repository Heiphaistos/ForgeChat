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
continuent de pointer vers la version précédente.

Signature (audit H4) : SHA256SUMS.txt doit être accompagné de SHA256SUMS.txt.sig, signature Ed25519
faite HORS LIGNE par scripts/release-sign.mjs (la clé privée n'est ni sur GitHub ni sur ce VPS).
Elle est vérifiée avec la clé publique ci-dessous AVANT toute lecture des empreintes ; une release
non signée n'est pas publiée (« en attente de signature »). Les deux fichiers sont copiés à côté des
binaires sous <famille>-v<version>.SHA256SUMS.txt(.sig) et référencés dans les manifestes : les
applications revérifient elles-mêmes la signature, le VPS n'est pas une autorité.

Vérification par `openssl pkeyutl -verify -rawin` (OpenSSL >= 3.0, présent sur le VPS) : aucune
dépendance Python hors bibliothèque standard.
"""
import hashlib
import json
import os
import base64
import binascii
import re
import subprocess
import sys
import tempfile
import urllib.error
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

# Clé publique de signature des releases (copie de deploy/release-signing-public.pem).
# Empreinte SHA-256 de la clé brute : e43061229a0116ef3f024c6b72fa26bb9e74c01834782e9f3229cf154ae7c2b6
SIGNING_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXki8pdvmJ4g6CsAf/PTBnZlXG3T7t7BOXUDjYLL4Tsg=
-----END PUBLIC KEY-----
"""


class Unsigned(Exception):
    """Release sans SHA256SUMS.txt.sig : pas une erreur, elle attend la signature hors ligne."""


def verify_signature(data, sig_b64, public_key=SIGNING_PUBLIC_KEY):
    """Vrai seulement si sig_b64 est la signature Ed25519 de data par public_key."""
    try:
        sig = base64.b64decode(sig_b64.strip(), validate=True)
    except (binascii.Error, ValueError):
        return False
    if len(sig) != 64:
        return False
    with tempfile.TemporaryDirectory() as d:
        paths = {}
        for name, content in (("pub.pem", public_key.encode()), ("data", data), ("sig", sig)):
            paths[name] = os.path.join(d, name)
            with open(paths[name], "wb") as f:
                f.write(content)
        r = subprocess.run(
            ["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", paths["pub.pem"], "-rawin",
             "-in", paths["data"], "-sigfile", paths["sig"]],
            capture_output=True, timeout=30, check=False,
        )
    return r.returncode == 0


def log(msg):
    print(msg, flush=True)


# Dépôt privé : jeton GitHub en lecture seule (Contents: read, ce seul dépôt), fichier root:forgechat-sync 640.
TOKEN_FILE = os.environ.get("FORGECHAT_GITHUB_TOKEN_FILE", "/etc/forgechat/releases-token")


def token():
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            return f.read().strip() or None
    except FileNotFoundError:
        return None


def get(url, accept="application/json"):
    headers = {"Accept": accept, "User-Agent": "forgechat-releases-sync", "X-GitHub-Api-Version": "2022-11-28"}
    t = token()
    # Le jeton ne part que vers l'API GitHub : la redirection des fichiers (stockage signé) se suit sans lui.
    if t and url.startswith("https://api.github.com/"):
        headers["Authorization"] = "Bearer " + t
    req = urllib.request.Request(url, headers=headers)
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


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def asset_location(url):
    """Asset d'API : GitHub répond 302 vers un stockage signé. urllib renverrait le jeton à cet
    autre hôte (refusé, et fuite) : on lit la redirection nous-mêmes puis on suit SANS jeton."""
    headers = {"Accept": "application/octet-stream", "User-Agent": "forgechat-releases-sync"}
    t = token()
    if t:
        headers["Authorization"] = "Bearer " + t
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers=headers), timeout=60):
            return url  # 200 direct (rare) : relu par get(), jeton compris
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
            return e.headers["Location"]
        raise


def download(url, path):
    h = hashlib.sha256()
    size = 0
    if url.startswith("https://api.github.com/"):
        url = asset_location(url)
    with get(url, "application/octet-stream") as r, open(path, "wb") as f:
        while chunk := r.read(1 << 20):
            size += len(chunk)
            if size > MAX_SIZE:
                raise ValueError(url + " : fichier trop gros")
            h.update(chunk)
            f.write(chunk)
    return h.hexdigest(), size


def write_file(name, data):
    tmp = os.path.join(DEST, "." + name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(DEST, name))


def write_json(name, data):
    write_file(name, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))


def read_asset(asset):
    with get(asset_location(asset["url"]), "application/octet-stream") as r:
        data = r.read(1 << 20)
        if r.read(1):
            raise ValueError(asset["name"] + " : trop gros")
    return data


def fetch_release(rel, kind, version, wanted):
    """Vérifie la signature, télécharge et vérifie les fichiers attendus. Rend
    ({cible: {url, sha256, size}}, {sums, sums_sig}) : URL publiques de SHA256SUMS.txt et .sig."""
    assets = {a["name"]: a for a in rel.get("assets", [])}
    if "SHA256SUMS.txt" not in assets:
        raise ValueError("SHA256SUMS.txt absent")
    if "SHA256SUMS.txt.sig" not in assets:
        raise Unsigned("SHA256SUMS.txt.sig absent")
    sums_bytes = read_asset(assets["SHA256SUMS.txt"])
    sig_bytes = read_asset(assets["SHA256SUMS.txt.sig"])
    if not verify_signature(sums_bytes, sig_bytes.decode("ascii", "replace")):
        raise ValueError("signature de SHA256SUMS.txt INVALIDE")
    sums = {}
    for line in sums_bytes.decode().splitlines():
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
                digest, size = download(assets[name]["url"], part)
            if digest != sums[name]:
                raise ValueError(name + " : empreinte " + digest + " au lieu de " + sums[name])
            if not os.path.exists(final):
                os.chmod(part, 0o644)
                os.replace(part, final)
            out[target] = {"url": name, "sha256": digest, "size": size}
            log("  " + name + " OK (" + str(size) + " octets)")
    sums_name = kind + "-v" + version + ".SHA256SUMS.txt"
    write_file(sums_name, sums_bytes)
    write_file(sums_name + ".sig", sig_bytes)
    return out, {"sums": BASE_URL + "/" + sums_name, "sums_sig": BASE_URL + "/" + sums_name + ".sig"}


def sync_desktop(version, rel):
    platforms, signed = fetch_release(rel, "desktop", version, DESKTOP)
    if not platforms:
        raise ValueError("aucun fichier de bureau dans la release")
    write_json("latest.json", {
        "version": version,
        "notes": rel.get("body") or "",
        "pub_date": rel.get("published_at") or "",
        "platforms": platforms,
        **signed,
    })


def sync_mobile(version, rel):
    platforms, signed = fetch_release(rel, "mobile", version, MOBILE)
    if not platforms:
        raise ValueError("aucun fichier mobile dans la release")
    notes = rel.get("body") or ""
    date = rel.get("published_at") or ""
    for p in platforms.values():
        p["url"] = BASE_URL + "/" + p["url"]
    write_json("mobile.json", {"version": version, "notes": notes, "pub_date": date, "platforms": platforms, **signed})
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
        signed_here = os.path.exists(os.path.join(DEST, kind + "-v" + version + ".SHA256SUMS.txt.sig"))
        if state.get(kind) == tag and signed_here:
            continue
        try:
            (sync_desktop if kind == "desktop" else sync_mobile)(version, rel)
        except Unsigned as e:
            # Release publiée avant la signature, ou .sig pas encore uploadé : les manifestes restent
            # tels quels et on réessaie au passage suivant. Pas un échec du service.
            if state.get(kind) != tag:
                log(tag + " : en attente de signature (" + str(e) + ")")
            continue
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
