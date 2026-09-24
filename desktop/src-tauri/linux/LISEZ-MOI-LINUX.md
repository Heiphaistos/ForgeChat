# ForgeChat pour Linux

## Quel paquet choisir

| Distribution | Paquet | Installation |
|---|---|---|
| Debian, Ubuntu, Mint, Pop!_OS | `.deb` | `sudo apt install ./ForgeChat-v<version>-amd64.deb` |
| Fedora, Nobara, openSUSE, RHEL | `.rpm` | `sudo dnf install ./ForgeChat-v<version>-x86_64.rpm` (openSUSE : `sudo zypper install ./…rpm`) |
| Toute autre (Arch, etc.) | `.AppImage` | `chmod +x ForgeChat-v<version>-amd64.AppImage` puis le lancer |

Le `.deb` et le `.rpm` installent eux-mêmes leurs dépendances. Préférez-les à
l'AppImage : ils utilisent le WebKitGTK de votre système.

Depuis la 3.30.1, l'AppImage ne livre plus ses propres bibliothèques Wayland :
sous Fedora 44 elles empêchaient WebKit de démarrer (fenêtre blanche).

## Dépendances

Installées automatiquement par le `.deb` et le `.rpm`. À installer à la main pour l'AppImage.

| Rôle | Debian / Ubuntu | Fedora | Arch |
|---|---|---|---|
| Moteur d'affichage (obligatoire) | `libwebkit2gtk-4.1-0` | `webkit2gtk4.1` | `webkit2gtk-4.1` |
| Icône de la zone de notification | `libayatana-appindicator3-1` | `libayatana-appindicator-gtk3` | `libayatana-appindicator` |
| Son des appels | `libpulse0` | `pulseaudio-libs` | `libpulse` |
| Partage d'écran (portail) | `xdg-desktop-portal xdg-desktop-portal-gtk` | `xdg-desktop-portal xdg-desktop-portal-gtk` | `xdg-desktop-portal xdg-desktop-portal-gtk` |
| Lancer une AppImage | `libfuse2` | `fuse fuse-libs` | `fuse2` |

Exemple Fedora, pour l'AppImage :

```
sudo dnf install webkit2gtk4.1 libayatana-appindicator-gtk3 pulseaudio-libs xdg-desktop-portal xdg-desktop-portal-gtk fuse fuse-libs
```

## La fenêtre reste blanche

Cela vient de la carte graphique (souvent NVIDIA sous Wayland), pas du paquet.

1. **Automatique** : si ForgeChat n'a pas réussi à s'afficher, le lancement
   suivant passe tout seul en mode compatibilité. Fermez-le et relancez-le.
2. **Raccourci** : lancez « ForgeChat (mode compatibilité) » depuis le menu des
   applications (installé par le `.deb` et le `.rpm`).
3. **Zone de notification** : clic droit sur l'icône ForgeChat, puis
   « Redémarrer en mode compatibilité ».
4. **Terminal** :

   ```
   forgechat-desktop --safe-mode
   ```

   AppImage : `./ForgeChat-v<version>-amd64.AppImage --safe-mode`

Le mode compatibilité force X11 (XWayland), le rendu logiciel et désactive la
synchronisation explicite NVIDIA. Il est retenu pour les lancements suivants ;
pour revenir au mode normal : clic droit sur l'icône, « Redémarrer en mode
normal », ou `rm ~/.config/forgechat/mode-compatibilite`.

### Si c'est toujours blanc

Lancez ForgeChat depuis un terminal et envoyez-nous ce qui s'affiche :

```
FORGECHAT_SAFE_MODE=1 forgechat-desktop 2>&1 | tee ~/forgechat-log.txt
```

Joignez aussi le résultat de :

```
echo $XDG_SESSION_TYPE; lspci -k | grep -A3 -i vga; cat /etc/os-release | head -3
```

En dernier recours, la version web marche dans tout navigateur :
https://forgechat.heiphaistos.org
