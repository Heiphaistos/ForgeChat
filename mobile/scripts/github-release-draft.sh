#!/usr/bin/env bash
# Crée une release GitHub en BROUILLON avec l'APK bêta, ses empreintes et le texte pour les
# utilisateurs. Ne publie JAMAIS : la publication se fait à la main sur github.com, après relecture.
#
#   scripts/github-release-draft.sh <propriétaire/dépôt> <fichier ForgeChat-x.y.z-beta.apk> [--allow-example]
#
# - Revérifie l'APK (scripts/release-apk.sh) avec l'empreinte du certificat officiel.
# - Refuse un APK construit pour un serveur d'exemple (example.org…), sauf --allow-example (test sur
#   un dépôt privé uniquement).
# - Joint l'APK et un SHA256SUMS.txt limité à cet APK ; tag v<version> créé à la publication.
# GUIDE_URL : lien du guide d'installation (défaut : page d'accueil du dépôt).
# Prérequis : gh connecté (gh auth status), Android SDK (comme release-apk.sh).
set -euo pipefail

# Certificat officiel de la bêta (public, identique à docs/MAINTAINER.md §4 et docs/INSTALLER.md).
CERT_SHA256=5E:A3:DB:62:2C:07:AA:69:54:D8:D9:2F:80:32:6E:24:60:A9:80:9C:94:80:5D:77:06:C0:0D:EC:E3:69:3C:BD

fail() { echo "ÉCHEC : $*" >&2; exit 1; }
REPO=${1:-}
APK=${2:-}
ALLOW_EXAMPLE=${3:-}
[ -n "$REPO" ] && [ -f "$APK" ] || fail "usage : github-release-draft.sh <propriétaire/dépôt> <ForgeChat-x.y.z-beta.apk> [--allow-example]"
[[ "$REPO" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || fail "dépôt invalide : $REPO"
HERE=$(cd "$(dirname "$0")" && pwd)

gh auth status >/dev/null 2>&1 || fail "gh n'est pas connecté : lance « gh auth login »"
gh api "repos/$REPO" --jq .full_name >/dev/null 2>&1 || fail "dépôt $REPO introuvable ou inaccessible"

# 1. Vérification complète de l'APK (signature, certificat, bêta sans outils de dev, serveur HTTPS).
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
NAME=$(basename "$APK")
cp "$APK" "$WORK/$NAME"
REPORT=$("$HERE/release-apk.sh" "$WORK/$NAME" "$CERT_SHA256") || fail "vérification de l'APK"
echo "$REPORT"
echo "$REPORT" | grep -q "package      org.heiphaistos.forgechat " || fail "ce n'est pas l'APK bêta (org.heiphaistos.forgechat)"
if echo "$REPORT" | grep -q "APK D'EXEMPLE" && [ "$ALLOW_EXAMPLE" != --allow-example ]; then
  fail "APK construit pour un serveur d'exemple : il ne doit pas être distribué"
fi
VERSION=$(echo "$REPORT" | sed -n 's/^  package      [^ ]* \([0-9.]*\) .*/\1/p')
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "version introuvable dans l'APK"
[ "$NAME" = "ForgeChat-$VERSION-beta.apk" ] || fail "le fichier doit s'appeler ForgeChat-$VERSION-beta.apk"
FILE_SHA256=$(echo "$REPORT" | sed -n 's/^  SHA-256      //p')
grep -q "^  push (FCM)   configuré" <<<"$REPORT" || echo "ATTENTION : APK sans notifications push"
TAG=v$VERSION

# 2. Pas de doublon (release ou brouillon existant pour ce tag).
gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && fail "une release $TAG existe déjà sur $REPO (brouillon compris)"

# 3. Empreintes et texte de la release.
(cd "$WORK" && grep -F "$NAME" SHA256SUMS.txt > SHA256SUMS.txt.tmp && mv SHA256SUMS.txt.tmp SHA256SUMS.txt)
cat > "$WORK/notes.md" <<EOF
## ForgeChat $VERSION (bêta Android)

**Télécharger** : \`$NAME\` ci-dessous (section *Assets*), depuis ton téléphone.

**Vérifier** (recommandé) — empreinte SHA-256 du fichier :
\`\`\`
$FILE_SHA256
\`\`\`
Certificat de signature (toujours le même ; Android le vérifie à chaque mise à jour) :
\`\`\`
$CERT_SHA256
\`\`\`

**Installer** : ouvre le fichier, autorise « cette source » quand Android le demande, puis
**Installer** (Play Protect : *Plus de détails* → *Installer quand même*). Retire ensuite l'autorisation.

**Mettre à jour** : installe la nouvelle version par-dessus (sans désinstaller) : tes données sont
conservées. Si Android parle de **conflit de signature**, arrête-toi : le fichier ne vient pas de nous.

Guide complet (vérification sur ordinateur, mises à jour) : ${GUIDE_URL:-https://github.com/$REPO#readme}

### Nouveautés
- _(à compléter avant publication)_

### À savoir
- Bêta : bugs possibles. Les messages ne sont **pas chiffrés de bout en bout**.
- L'app vérifie une fois par jour s'il existe une nouvelle version (requête anonyme à GitHub,
  désactivable : *Vous* → *Sécurité et confidentialité* → *Mises à jour*).
EOF

# 4. Brouillon : jamais publié par ce script.
URL=$(gh release create "$TAG" "$WORK/$NAME" "$WORK/SHA256SUMS.txt" \
  --repo "$REPO" --draft --title "ForgeChat $VERSION (bêta)" --notes-file "$WORK/notes.md")
echo
echo "BROUILLON créé (non publié) : $URL"
echo "Relis-le sur GitHub, complète « Nouveautés », puis clique « Publish release » toi-même."
