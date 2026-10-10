"""python3 -I deploy/test_forgechat_releases_sync.py : vérifie la garde de signature avec une clé jetable."""
import base64
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forgechat_releases_sync as sync  # noqa: E402


def openssl(*args):
    subprocess.run(["openssl", *args], check=True, capture_output=True, timeout=30)


with tempfile.TemporaryDirectory() as d:
    key, pub, data, sig = (os.path.join(d, n) for n in ("k.pem", "p.pem", "data", "sig"))
    openssl("genpkey", "-algorithm", "ed25519", "-out", key)
    openssl("pkey", "-in", key, "-pubout", "-out", pub)
    body = b"0" * 64 + b"  ForgeChat-1.0.0.apk\n"
    with open(data, "wb") as f:
        f.write(body)
    openssl("pkeyutl", "-sign", "-inkey", key, "-rawin", "-in", data, "-out", sig)
    with open(sig, "rb") as f:
        sig_b64 = base64.b64encode(f.read()).decode()
    with open(pub, encoding="ascii") as f:
        pem = f.read()

    assert sync.verify_signature(body, sig_b64, pem), "signature valide refusée"
    assert not sync.verify_signature(body + b"x", sig_b64, pem), "fichier modifié accepté"
    assert not sync.verify_signature(body, sig_b64, sync.SIGNING_PUBLIC_KEY), "autre clé acceptée"
    assert not sync.verify_signature(body, "AAAA", pem), "signature tronquée acceptée"
    assert not sync.verify_signature(body, "pas du base64 !", pem), "base64 invalide accepté"
print("OK")
