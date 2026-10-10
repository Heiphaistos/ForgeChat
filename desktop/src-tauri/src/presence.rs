//! Activité « Joue à … » automatique (comme Discord) : l'app de bureau repère un jeu lancé et le
//! client web l'affiche sur le profil (PATCH /users/me). Rien n'est envoyé si l'utilisateur coupe
//! le réglage côté web. Détection locale, sans base distante :
//! - jeux installés par un lanceur (dossier Steam, Epic, Riot, GOG, Ubisoft, EA, Battle.net) :
//!   le nom du jeu est celui de son dossier ;
//! - quelques exécutables connus hors lanceur.

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};

/// Dossier parent d'un jeu par lanceur (chemin en minuscules, séparateurs `/`).
const LAUNCHER_DIRS: &[&str] = &[
    "/steamapps/common/",
    "/epic games/",
    "/riot games/",
    "/gog galaxy/games/",
    "/ubisoft game launcher/games/",
    "/ea games/",
    "/battle.net/",
];

/// Sous-dossiers des lanceurs qui ne sont pas des jeux.
const NOT_GAMES: &[&str] = &[
    "steamworks shared", "steamvr", "steam controller configs", "launcher", "directxredist",
    "riot client", "epic online services", "battle.net", "battle.net launcher",
];

/// Exécutables connus hors lanceur : (nom de fichier sans extension, en minuscules ; nom affiché).
const KNOWN_EXES: &[(&str, &str)] = &[
    ("metin2client", "Metin2"),
    ("metin2", "Metin2"),
    ("forgemt2", "ForgeMT2"),
    ("minecraft", "Minecraft"),
    ("javaw-minecraft", "Minecraft"),
    ("fortniteclient-win64-shipping", "Fortnite"),
    ("league of legends", "League of Legends"),
    ("valorant-win64-shipping", "VALORANT"),
    ("gta5", "Grand Theft Auto V"),
    ("rocketleague", "Rocket League"),
    ("robloxplayerbeta", "Roblox"),
    ("osu!", "osu!"),
    ("wow", "World of Warcraft"),
    ("overwatch", "Overwatch 2"),
    ("diablo iv", "Diablo IV"),
];

/// Nom du jeu correspondant au chemin d'un exécutable, s'il en est un.
pub fn game_from_path(path: &str) -> Option<String> {
    let norm = path.replace('\\', "/");
    let lower = norm.to_lowercase();
    for dir in LAUNCHER_DIRS {
        if let Some(i) = lower.find(dir) {
            let start = i + dir.len();
            let rest = &norm[start..];
            let name = rest.split('/').next().unwrap_or("").trim();
            // Le fichier lui-même juste sous le dossier du lanceur n'est pas un dossier de jeu.
            if name.is_empty() || !rest.contains('/') || NOT_GAMES.contains(&name.to_lowercase().as_str()) {
                continue;
            }
            return Some(name.chars().take(64).collect());
        }
    }
    let file = lower.rsplit('/').next().unwrap_or("");
    let stem = file.strip_suffix(".exe").unwrap_or(file);
    KNOWN_EXES.iter().find(|(exe, _)| *exe == stem).map(|(_, n)| (*n).to_string())
}

/// Jeu en cours d'exécution (le premier trouvé), sinon None.
/// Commande asynchrone : une commande synchrone tourne sur le thread de l'interface.
#[tauri::command]
pub async fn current_game() -> Option<String> {
    tauri::async_runtime::spawn_blocking(current_game_sync).await.ok().flatten()
}

fn current_game_sync() -> Option<String> {
    let kind = ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet);
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_processes(kind));
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
    let mut games: Vec<String> = sys
        .processes()
        .values()
        .filter_map(|p| p.exe().and_then(|e| e.to_str()).and_then(game_from_path))
        .collect();
    games.sort();
    games.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::game_from_path;

    #[test]
    fn detecte_les_jeux() {
        assert_eq!(game_from_path(r"C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe").as_deref(), Some("Counter-Strike Global Offensive"));
        assert_eq!(game_from_path("/home/evan/.local/share/Steam/steamapps/common/Hades/Hades.exe").as_deref(), Some("Hades"));
        assert_eq!(game_from_path(r"D:\Epic Games\Fortnite\FortniteGame\Binaries\Win64\x.exe").as_deref(), Some("Fortnite"));
        assert_eq!(game_from_path(r"D:\Jeux\ForgeMT2\metin2client.exe").as_deref(), Some("Metin2"));
    }

    #[test]
    fn parcourt_les_processus_reels_sans_planter() {
        let _ = super::current_game_sync();
    }

    #[test]
    fn ignore_les_lanceurs_et_le_reste() {
        assert_eq!(game_from_path(r"C:\Program Files (x86)\Steam\steam.exe"), None);
        assert_eq!(game_from_path(r"C:\Program Files (x86)\Steam\steamapps\common\Steamworks Shared\x.exe"), None);
        assert_eq!(game_from_path(r"C:\Riot Games\Riot Client\RiotClientServices.exe"), None);
        assert_eq!(game_from_path(r"C:\Windows\explorer.exe"), None);
    }
}
