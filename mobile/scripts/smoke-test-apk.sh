#!/usr/bin/env bash
# Test de démarrage RÉEL d'un APK sur un émulateur Android : installation propre, puis plusieurs
# démarrages à froid ; échec si l'app plante, se ferme ou n'affiche pas son écran.
#
#   scripts/smoke-test-apk.sh <fichier.apk>
#
# L'APK doit contenir l'ABI de l'émulateur (x86_64) : FORGECHAT_ABIS=x86_64 au build.
# Émulateur : un AVD dédié « forgechat_smoke » (sans code PIN), créé au premier lancement depuis
# l'image système x86_64 installée ; démarré sans fenêtre puis arrêté à la fin s'il ne tournait pas.
# Variables : FORGECHAT_SMOKE_AVD (nom de l'AVD), FORGECHAT_SMOKE_RUNS (démarrages, défaut 3).
# En cas d'échec, les journaux sont gardés dans ~/forgechat-releases/smoke-logs/.
set -euo pipefail

APK=${1:?usage : smoke-test-apk.sh <fichier.apk>}
[ -f "$APK" ] || { echo "ÉCHEC : fichier introuvable : $APK" >&2; exit 1; }
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
ADB=$SDK/platform-tools/adb
EMULATOR=$SDK/emulator/emulator
AVDMANAGER=$(ls "$SDK"/cmdline-tools/*/bin/avdmanager 2>/dev/null | head -1)
AAPT2=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)/aapt2
AVD=${FORGECHAT_SMOKE_AVD:-forgechat_smoke}
RUNS=${FORGECHAT_SMOKE_RUNS:-3}
LOGDIR=$HOME/forgechat-releases/smoke-logs
fail() { echo "ÉCHEC : $*" >&2; exit 1; }

PKG=$("$AAPT2" dump badging "$APK" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
ACTIVITY=$("$AAPT2" dump badging "$APK" | sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p")
[ -n "$PKG" ] && [ -n "$ACTIVITY" ] || fail "package ou activité de lancement introuvable"
"$AAPT2" dump badging "$APK" | grep -q "native-code:.*'x86_64'" ||
  fail "l'APK ne contient pas l'ABI x86_64 de l'émulateur (construire avec FORGECHAT_ABIS=x86_64)"

# 1. Émulateur : réutilise celui qui tourne déjà, sinon démarre l'AVD dédié.
SERIAL=$("$ADB" devices | awk '/^emulator-[0-9]+\tdevice$/{print $1; exit}')
STARTED=""
if [ -z "$SERIAL" ]; then
  if ! "$EMULATOR" -list-avds | grep -qx "$AVD"; then
    IMAGE=$(cd "$SDK" && ls -d system-images/*/*/x86_64 2>/dev/null | sort -V | tail -1)
    [ -n "$IMAGE" ] && [ -n "$AVDMANAGER" ] || fail "ni AVD « $AVD » ni image système x86_64 pour le créer"
    echo "Création de l'AVD $AVD ($IMAGE)"
    echo no | "$AVDMANAGER" -s create avd -n "$AVD" -k "${IMAGE//\//;}" -d pixel_5 >/dev/null 2>&1
    # Petit disque (10 Go par défaut) : un test de démarrage n'a besoin que de quelques Go.
    sed -i 's/^disk.dataPartition.size=.*/disk.dataPartition.size=4G/' "$HOME/.android/avd/$AVD.avd/config.ini"
  fi
  echo "Démarrage de l'émulateur $AVD (sans fenêtre)…"
  EMU_LOG=$(mktemp)
  "$EMULATOR" -avd "$AVD" -no-window -no-snapshot -no-audio -no-boot-anim >"$EMU_LOG" 2>&1 &
  STARTED=$!
  trap '[ -n "$STARTED" ] && "$ADB" -s "$SERIAL" emu kill >/dev/null 2>&1 || true' EXIT
  for _ in $(seq 120); do
    SERIAL=$("$ADB" devices | awk '/^emulator-[0-9]+\tdevice$/{print $1; exit}')
    [ -n "$SERIAL" ] && [ "$("$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
    sleep 2
  done
  [ -n "$SERIAL" ] || fail "l'émulateur n'a pas démarré : $(grep -m1 -E 'FATAL|ERROR' "$EMU_LOG" || echo 'voir '"$EMU_LOG")"
fi
A() { "$ADB" -s "$SERIAL" "$@"; }
A shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
A shell wm dismiss-keyguard >/dev/null 2>&1 || true

# 2. Installation propre.
A uninstall "$PKG" >/dev/null 2>&1 || true
A install "$APK" | grep -q Success || fail "installation refusée"

# 3. Démarrages à froid.
for run in $(seq "$RUNS"); do
  A shell am force-stop "$PKG"
  A logcat -b all -c
  A shell am start -W -n "$PKG/$ACTIVITY" >/dev/null 2>&1 || true
  sleep 15
  CRASH=$(A logcat -d -b crash 2>/dev/null | grep -E "Fatal signal|FATAL EXCEPTION|Process: $PKG|>>> $PKG <<<" | head -3 || true)
  PID=$(A shell pidof "$PKG" 2>/dev/null | tr -d '\r' || true)
  FOCUS=$(A shell dumpsys window 2>/dev/null | grep -m1 -E "mCurrentFocus|mFocusedApp" || true)
  if [ -n "$CRASH" ] || [ -z "$PID" ] || ! grep -qF "$PKG" <<<"$FOCUS"; then
    mkdir -p "$LOGDIR"
    LOG=$LOGDIR/$(date +%Y%m%d-%H%M%S)-$PKG.log
    { echo "APK : $APK (démarrage $run/$RUNS)"; echo "focus : $FOCUS"; echo "--- crash"; A logcat -d -b crash; echo "--- tout"; A logcat -d -b all; } > "$LOG" 2>&1
    WHY="écran de l'app absent"
    [ -z "$PID" ] && WHY="processus arrêté"
    [ -n "$CRASH" ] && WHY="plantage"
    fail "démarrage $run/$RUNS : $WHY (journaux : $LOG)"
  fi
  echo "  démarrage à froid $run/$RUNS : OK (processus $PID, écran de l'app au premier plan)"
done
A uninstall "$PKG" >/dev/null 2>&1 || true
echo "OK : $(basename "$APK") démarre sans planter ($RUNS démarrages à froid sur $SERIAL)"
