use std::{collections::{HashMap, HashSet}, sync::Arc, time::{Duration, Instant}};
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::{broadcast, Mutex, RwLock};
use uuid::Uuid;

use crate::config::Config;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Permission « Partager l'écran / Go Live » (bit 40), déclarée côté UI
/// (`RolesTab.tsx:85`) mais absente de `models::role::Permissions`.
/// Définie ici pour ne pas modifier le modèle de rôles hors périmètre.
pub const PERM_STREAM: i64 = crate::models::role::Permissions::STREAM;

/// Fenêtre de grâce pendant laquelle un canal vocal temporaire fraîchement créé
/// ne peut pas être supprimé par `cleanup_voice` (correctif N1 : la redirection
/// auto-create faisait leave→delete→join et détruisait le canal juste créé).
pub const TEMP_CHANNEL_GRACE: Duration = Duration::from_secs(10);

/// TTL du cache Redis de reprise de l'état vocal (N2/N3).
pub const VOICE_REDIS_TTL_S: u64 = 120;
const VOICE_REDIS_KEY: &str = "voice:snapshot";

pub type WsSender = broadcast::Sender<String>;
pub type ClientMap = Arc<RwLock<HashMap<Uuid, WsSender>>>;
pub type ConnCountMap = Arc<RwLock<HashMap<Uuid, usize>>>;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VoiceStateData {
    pub channel_id: Uuid,
    pub muted: bool,
    pub deafened: bool,
    pub video: bool,
    pub screen: bool,
}

/// Instantané sérialisé dans Redis. La mémoire process reste la source de
/// vérité ; Redis n'est qu'un cache de reprise après redémarrage.
#[derive(Serialize, Deserialize, Default)]
struct VoiceSnapshot {
    rooms: HashMap<Uuid, Vec<Uuid>>,
    user_voice: HashMap<Uuid, Uuid>,
    states: HashMap<Uuid, VoiceStateData>,
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: Arc<Mutex<MultiplexedConnection>>,
    pub config: Config,
    pub clients: ClientMap,
    pub conn_counts: ConnCountMap,
    pub channel_subs: Arc<RwLock<HashMap<Uuid, broadcast::Sender<String>>>>,
    // Salons vocaux : channel_id → {user_id}
    pub voice_rooms: Arc<RwLock<HashMap<Uuid, HashSet<Uuid>>>>,
    // Utilisateur courant dans quel salon : user_id → channel_id
    pub user_voice: Arc<RwLock<HashMap<Uuid, Uuid>>>,
    // État vocal par utilisateur : mute, vidéo, screen share
    pub voice_states: Arc<RwLock<HashMap<Uuid, VoiceStateData>>>,
    // Canaux Scène : channel_id → {user_id} des speakers actuels
    pub stage_speakers: Arc<RwLock<HashMap<Uuid, HashSet<Uuid>>>>,
    // Canaux Scène : channel_id → user_id → {username, avatar} des mains levées
    pub stage_hand_raises: Arc<RwLock<HashMap<Uuid, HashMap<Uuid, serde_json::Value>>>>,
    // Mains levées en vocal (N13) : channel_id → user_id → {username, avatar}
    pub voice_hand_raises: Arc<RwLock<HashMap<Uuid, HashMap<Uuid, serde_json::Value>>>>,
    // N5 : quelle session WS détient le vocal pour cet utilisateur.
    // user_id → session_id. Une fermeture d'onglet qui n'est PAS la session
    // vocale ne doit pas éjecter l'utilisateur du salon.
    pub voice_sessions: Arc<RwLock<HashMap<Uuid, Uuid>>>,
    // N1 : canaux temporaires fraîchement créés (channel_id → instant de création)
    pub temp_channels_created: Arc<RwLock<HashMap<Uuid, Instant>>>,
    // Client HTTP partagé (pool de connexions réutilisé)
    pub http_client: reqwest::Client,
}

impl AppState {
    /// Async depuis la 3.249 : reconstruit l'état vocal depuis Redis (N2/N3)
    /// et lance le rafraîchisseur de TTL.
    pub async fn new(
        db: PgPool,
        redis: MultiplexedConnection,
        config: Config,
    ) -> Self {
        let http_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(3))
            .user_agent(format!("ForgeChat/{} (+https://forgechat.heiphaistos.org)", APP_VERSION))
            .build()
            .expect("Failed to build HTTP client");
        let state = Self {
            db,
            redis: Arc::new(Mutex::new(redis)),
            config,
            clients: Arc::new(RwLock::new(HashMap::new())),
            conn_counts: Arc::new(RwLock::new(HashMap::new())),
            channel_subs: Arc::new(RwLock::new(HashMap::new())),
            voice_rooms: Arc::new(RwLock::new(HashMap::new())),
            user_voice: Arc::new(RwLock::new(HashMap::new())),
            voice_states: Arc::new(RwLock::new(HashMap::new())),
            stage_speakers: Arc::new(RwLock::new(HashMap::new())),
            stage_hand_raises: Arc::new(RwLock::new(HashMap::new())),
            voice_hand_raises: Arc::new(RwLock::new(HashMap::new())),
            voice_sessions: Arc::new(RwLock::new(HashMap::new())),
            temp_channels_created: Arc::new(RwLock::new(HashMap::new())),
            http_client,
        };

        state.restore_voice_from_redis().await;

        // Rafraîchissement du TTL Redis : l'instantané expire en 120 s si le
        // process meurt, mais reste vivant tant qu'il tourne.
        let refresher = state.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(VOICE_REDIS_TTL_S / 3));
            loop {
                tick.tick().await;
                refresher.persist_voice_to_redis().await;
            }
        });

        state
    }

    // ─── Persistance Redis de l'état vocal (N2/N3) ──────────────────────
    // ponytail: un seul instantané JSON au lieu d'une clé par salon/utilisateur.
    // Suffisant pour quelques milliers d'utilisateurs en vocal ; passer à des
    // clés par canal si l'écriture complète devient un point chaud.

    pub async fn persist_voice_to_redis(&self) {
        let snap = VoiceSnapshot {
            rooms: self.voice_rooms.read().await.iter()
                .filter(|(_, m)| !m.is_empty())
                .map(|(c, m)| (*c, m.iter().copied().collect()))
                .collect(),
            user_voice: self.user_voice.read().await.clone(),
            states: self.voice_states.read().await.clone(),
        };
        let Ok(json) = serde_json::to_string(&snap) else { return; };
        use redis::AsyncCommands;
        let mut redis = self.redis.lock().await;
        let _: () = redis
            .set_ex(VOICE_REDIS_KEY, json, VOICE_REDIS_TTL_S)
            .await
            .unwrap_or(());
    }

    async fn restore_voice_from_redis(&self) {
        let raw: Option<String> = {
            use redis::AsyncCommands;
            let mut redis = self.redis.lock().await;
            redis.get(VOICE_REDIS_KEY).await.unwrap_or(None)
        };
        let Some(raw) = raw else { return; };
        let Ok(snap) = serde_json::from_str::<VoiceSnapshot>(&raw) else {
            tracing::warn!("Voice: instantané Redis illisible, état vocal reparti à vide");
            return;
        };
        let mut rooms = self.voice_rooms.write().await;
        for (channel_id, users) in snap.rooms {
            rooms.insert(channel_id, users.into_iter().collect());
        }
        drop(rooms);
        *self.user_voice.write().await = snap.user_voice;
        *self.voice_states.write().await = snap.states;
        tracing::info!(
            "Voice: état vocal restauré depuis Redis ({} salons, {} utilisateurs)",
            self.voice_rooms.read().await.len(),
            self.user_voice.read().await.len()
        );
    }

    pub async fn get_or_create_channel_tx(&self, channel_id: Uuid) -> broadcast::Sender<String> {
        {
            let read = self.channel_subs.read().await;
            if let Some(tx) = read.get(&channel_id) {
                return tx.clone();
            }
        }
        let mut write = self.channel_subs.write().await;
        // Double-check sous le verrou exclusif pour éviter la race TOCTOU
        if let Some(tx) = write.get(&channel_id) {
            return tx.clone();
        }
        let (tx, _) = broadcast::channel(256);
        write.insert(channel_id, tx.clone());
        tx
    }

    pub async fn broadcast_to_user(&self, user_id: Uuid, event: String) {
        let read = self.clients.read().await;
        if let Some(tx) = read.get(&user_id) {
            let _ = tx.send(event);
        }
    }

    /// Broadcast to connected members of a server.
    /// Only queries users who are currently connected (avoids N full-member scans for large servers).
    pub async fn broadcast_to_server_members(&self, server_id: Uuid, event: String) {
        let connected: Vec<Uuid> = self.clients.read().await.keys().copied().collect();
        if connected.is_empty() { return; }
        // Intersect connected clients with server membership in one query
        let member_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT user_id FROM server_members WHERE server_id=$1 AND user_id = ANY($2)"
        )
        .bind(server_id)
        .bind(&connected)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();

        let clients = self.clients.read().await;
        for uid in member_ids {
            if let Some(tx) = clients.get(&uid) {
                let _ = tx.send(event.clone());
            }
        }
    }

    /// Broadcast aux membres connectés du serveur du canal **qui peuvent voir ce
    /// canal** (correctif N14 : les overrides `channel_permissions` sont
    /// désormais respectés, un canal privé ne fuit plus vers tout le serveur).
    pub async fn broadcast_to_channel_members(&self, channel_id: Uuid, event: String) {
        self.broadcast_to_channel_members_except(channel_id, None, event).await;
    }

    /// Variante avec exclusion d'un utilisateur (l'émetteur), pour remplacer
    /// `broadcast_to_all(state, user_id, …)` sans provoquer d'écho (N10).
    pub async fn broadcast_to_channel_members_except(
        &self,
        channel_id: Uuid,
        exclude: Option<Uuid>,
        event: String,
    ) {
        let audience = self.channel_audience(channel_id).await;
        if audience.is_empty() { return; }
        let clients = self.clients.read().await;
        for uid in audience {
            if Some(uid) == exclude { continue; }
            if let Some(tx) = clients.get(&uid) {
                let _ = tx.send(event.clone());
            }
        }
    }

    // ─── Permissions effectives par canal (overrides channel_permissions) ────

    /// Membres connectés du serveur du canal ayant `VIEW_CHANNEL` après
    /// application des overrides de canal.
    pub async fn channel_audience(&self, channel_id: Uuid) -> Vec<Uuid> {
        use sqlx::Row;
        let connected: Vec<Uuid> = self.clients.read().await.keys().copied().collect();
        if connected.is_empty() { return vec![]; }

        let Some(server_id) = self.channel_server_id(channel_id).await else { return vec![]; };

        // Base : appartenance + permissions combinées (rôles + @everyone)
        let rows = sqlx::query(
            "SELECT sm.user_id, sm.is_owner,
                    COALESCE(BIT_OR(r.permissions), 0)
                    | COALESCE((SELECT permissions FROM roles WHERE server_id=$1 AND is_everyone=true), 0)
                    AS combined_perms
             FROM server_members sm
             LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
             LEFT JOIN roles r ON r.id = mr.role_id
             WHERE sm.server_id = $1 AND sm.user_id = ANY($2)
             GROUP BY sm.user_id, sm.is_owner"
        )
        .bind(server_id)
        .bind(&connected)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();
        if rows.is_empty() { return vec![]; }

        let overrides = self.channel_overrides(channel_id).await;
        if overrides.is_empty() {
            // Aucun override : comportement historique (tous les membres connectés)
            return rows.iter().map(|r| r.get::<Uuid, _>("user_id")).collect();
        }

        let everyone_role = self.everyone_role_id(server_id).await;
        let member_ids: Vec<Uuid> = rows.iter().map(|r| r.get::<Uuid, _>("user_id")).collect();
        let role_rows = sqlx::query(
            "SELECT user_id, role_id FROM member_roles WHERE server_id=$1 AND user_id = ANY($2)"
        )
        .bind(server_id)
        .bind(&member_ids)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default();

        let mut roles_by_user: HashMap<Uuid, HashSet<Uuid>> = HashMap::new();
        for r in &role_rows {
            roles_by_user
                .entry(r.get::<Uuid, _>("user_id"))
                .or_default()
                .insert(r.get::<Uuid, _>("role_id"));
        }

        let view = crate::models::role::Permissions::VIEW_CHANNEL;
        rows.iter()
            .filter_map(|r| {
                let uid: Uuid = r.get("user_id");
                let perms = apply_channel_overrides(
                    r.get::<i64, _>("combined_perms"),
                    r.get::<bool, _>("is_owner"),
                    uid,
                    roles_by_user.get(&uid),
                    everyone_role,
                    &overrides,
                );
                if perms & view != 0 { Some(uid) } else { None }
            })
            .collect()
    }

    /// Masque de permissions effectif d'un utilisateur **sur un canal donné**
    /// (rôles + @everyone, puis overrides `channel_permissions`).
    /// Renvoie `None` si l'utilisateur n'est pas membre du serveur du canal.
    pub async fn effective_channel_permissions(
        &self,
        user_id: Uuid,
        channel_id: Uuid,
    ) -> Option<(Uuid, i64)> {
        use sqlx::Row;
        let server_id = self.channel_server_id(channel_id).await?;
        let row = sqlx::query(
            "SELECT sm.is_owner,
                    COALESCE(BIT_OR(r.permissions), 0)
                    | COALESCE((SELECT permissions FROM roles WHERE server_id=$2 AND is_everyone=true), 0)
                    AS combined_perms
             FROM server_members sm
             LEFT JOIN member_roles mr ON mr.user_id = sm.user_id AND mr.server_id = sm.server_id
             LEFT JOIN roles r ON r.id = mr.role_id
             WHERE sm.user_id = $1 AND sm.server_id = $2
             GROUP BY sm.is_owner"
        )
        .bind(user_id)
        .bind(server_id)
        .fetch_optional(&self.db)
        .await
        .ok()
        .flatten()?;

        let overrides = self.channel_overrides(channel_id).await;
        let my_roles: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
            "SELECT role_id FROM member_roles WHERE server_id=$1 AND user_id=$2"
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect();

        let perms = apply_channel_overrides(
            row.get::<i64, _>("combined_perms"),
            row.get::<bool, _>("is_owner"),
            user_id,
            Some(&my_roles),
            self.everyone_role_id(server_id).await,
            &overrides,
        );
        Some((server_id, perms))
    }

    pub async fn channel_server_id(&self, channel_id: Uuid) -> Option<Uuid> {
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT server_id FROM channels WHERE id=$1")
            .bind(channel_id)
            .fetch_optional(&self.db)
            .await
            .ok()
            .flatten()
            .flatten()
    }

    async fn everyone_role_id(&self, server_id: Uuid) -> Option<Uuid> {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM roles WHERE server_id=$1 AND is_everyone=true LIMIT 1"
        )
        .bind(server_id)
        .fetch_optional(&self.db)
        .await
        .ok()
        .flatten()
    }

    /// (target_id, target_type, allow, deny) des overrides du canal.
    async fn channel_overrides(&self, channel_id: Uuid) -> Vec<(Uuid, String, i64, i64)> {
        use sqlx::Row;
        sqlx::query(
            "SELECT target_id, target_type, allow, deny FROM channel_permissions WHERE channel_id=$1"
        )
        .bind(channel_id)
        .fetch_all(&self.db)
        .await
        .unwrap_or_default()
        .iter()
        .map(|r| (
            r.get::<Uuid, _>("target_id"),
            r.get::<String, _>("target_type"),
            r.get::<i64, _>("allow"),
            r.get::<i64, _>("deny"),
        ))
        .collect()
    }

    // Rejoindre un salon vocal — retourne les user_ids déjà présents
    /// Rejoindre un salon vocal. Retourne `None` si la limite est atteinte.
    pub async fn voice_join(&self, user_id: Uuid, channel_id: Uuid, max_users: Option<usize>) -> Option<Vec<Uuid>> {
        // Auto-leave de l'ancien salon si nécessaire
        {
            let mut user_voice = self.user_voice.write().await;
            if let Some(old_ch) = user_voice.get(&user_id).copied() {
                if old_ch != channel_id {
                    let mut rooms = self.voice_rooms.write().await;
                    if let Some(room) = rooms.get_mut(&old_ch) {
                        room.remove(&user_id);
                    }
                }
            }
            user_voice.insert(user_id, channel_id);
        }

        let mut rooms = self.voice_rooms.write().await;
        let room = rooms.entry(channel_id).or_insert_with(HashSet::new);
        // Vérification atomique de la limite (dans le write lock pour éviter la race condition)
        if let Some(limit) = max_users {
            if limit > 0 && !room.contains(&user_id) && room.len() >= limit {
                return None;
            }
        }
        let existing: Vec<Uuid> = room.iter().filter(|&&u| u != user_id).copied().collect();
        room.insert(user_id);
        drop(rooms);
        self.persist_voice_to_redis().await;
        Some(existing)
    }

    /// Quitter le salon vocal — retourne le channel_id quitté, les pairs restants
    /// et l'état vocal qu'avait l'utilisateur (nécessaire pour émettre `STREAM_END`
    /// quand il partageait son écran, correctif S2).
    pub async fn voice_leave(&self, user_id: Uuid) -> Option<(Uuid, Vec<Uuid>, Option<VoiceStateData>)> {
        let mut user_voice = self.user_voice.write().await;
        let channel_id = user_voice.remove(&user_id)?;
        drop(user_voice);

        let prev_state = self.voice_states.write().await.remove(&user_id);
        self.voice_sessions.write().await.remove(&user_id);

        let mut rooms = self.voice_rooms.write().await;
        let remaining: Vec<Uuid> = if let Some(room) = rooms.get_mut(&channel_id) {
            room.remove(&user_id);
            room.iter().copied().collect()
        } else {
            vec![]
        };
        drop(rooms);
        self.persist_voice_to_redis().await;
        Some((channel_id, remaining, prev_state))
    }

    /// N1 — marque un canal temporaire comme fraîchement créé.
    pub async fn mark_temp_channel(&self, channel_id: Uuid) {
        let mut map = self.temp_channels_created.write().await;
        map.retain(|_, t| t.elapsed() < TEMP_CHANNEL_GRACE * 6);
        map.insert(channel_id, Instant::now());
    }

    /// N1 — vrai si le canal a été créé il y a moins de `TEMP_CHANNEL_GRACE`.
    /// Pendant cette fenêtre, `cleanup_voice` ne doit PAS le supprimer : la
    /// redirection auto-create fait leave()→join() et la room est vide entre
    /// les deux.
    pub async fn temp_channel_in_grace(&self, channel_id: Uuid) -> bool {
        self.temp_channels_created
            .read()
            .await
            .get(&channel_id)
            .map(|t| t.elapsed() < TEMP_CHANNEL_GRACE)
            .unwrap_or(false)
    }

    /// N13 — retire la main levée en vocal d'un utilisateur partout.
    /// Retourne les canaux où elle était levée.
    pub async fn voice_hand_cleanup(&self, user_id: Uuid) -> Vec<Uuid> {
        let mut raises = self.voice_hand_raises.write().await;
        let mut affected = Vec::new();
        for (channel_id, map) in raises.iter_mut() {
            if map.remove(&user_id).is_some() {
                affected.push(*channel_id);
            }
        }
        raises.retain(|_, m| !m.is_empty());
        affected
    }

    /// Retire un utilisateur déconnecté de TOUT état Scène (speaker + main levée),
    /// dans tous les canaux où il apparaît. Utilisé uniquement à la vraie
    /// déconnexion WS (crash, fermeture d'onglet) — PAS sur un simple VOICE_LEAVE,
    /// qui peut n'être qu'une reconnexion interne (ex: passage écoute→speaker,
    /// qui fait un leave()+join() du mesh vocal sans quitter la scène). Retourne
    /// la liste des (channel_id, était_speaker, avait_main_levée) affectés.
    pub async fn stage_cleanup_user_everywhere(&self, user_id: Uuid) -> Vec<(Uuid, bool, bool)> {
        let mut affected: std::collections::HashMap<Uuid, (bool, bool)> = std::collections::HashMap::new();
        {
            let mut speakers = self.stage_speakers.write().await;
            for (channel_id, set) in speakers.iter_mut() {
                if set.remove(&user_id) {
                    affected.entry(*channel_id).or_insert((false, false)).0 = true;
                }
            }
        }
        {
            let mut raises = self.stage_hand_raises.write().await;
            for (channel_id, map) in raises.iter_mut() {
                if map.remove(&user_id).is_some() {
                    affected.entry(*channel_id).or_insert((false, false)).1 = true;
                }
            }
        }
        affected.into_iter().map(|(c, (s, h))| (c, s, h)).collect()
    }

}

/// Applique les overrides `channel_permissions` sur un masque de base, dans
/// l'ordre Discord : @everyone, puis les rôles du membre (deny cumulés puis
/// allow cumulés), puis l'override nominatif du membre.
/// Owner et ADMINISTRATOR passent outre tous les overrides.
pub fn apply_channel_overrides(
    base: i64,
    is_owner: bool,
    user_id: Uuid,
    user_roles: Option<&HashSet<Uuid>>,
    everyone_role: Option<Uuid>,
    overrides: &[(Uuid, String, i64, i64)],
) -> i64 {
    if is_owner || base & crate::models::role::Permissions::ADMINISTRATOR != 0 {
        return i64::MAX;
    }
    let mut perms = base;

    if let Some(ev) = everyone_role {
        if let Some((_, _, allow, deny)) = overrides
            .iter()
            .find(|(id, t, _, _)| *id == ev && t == "role")
        {
            perms = (perms & !deny) | allow;
        }
    }

    let mut role_allow = 0i64;
    let mut role_deny = 0i64;
    if let Some(roles) = user_roles {
        for (id, t, allow, deny) in overrides {
            if t == "role" && Some(*id) != everyone_role && roles.contains(id) {
                role_allow |= allow;
                role_deny |= deny;
            }
        }
    }
    perms = (perms & !role_deny) | role_allow;

    if let Some((_, _, allow, deny)) = overrides
        .iter()
        .find(|(id, t, _, _)| *id == user_id && t == "member")
    {
        perms = (perms & !deny) | allow;
    }
    perms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::role::Permissions as P;

    #[test]
    fn overrides_follow_discord_order() {
        let ev = Uuid::new_v4();
        let role = Uuid::new_v4();
        let me = Uuid::new_v4();
        let roles: HashSet<Uuid> = [role].into_iter().collect();

        // @everyone retire CONNECT_VOICE, un rôle le redonne
        let ov = vec![
            (ev, "role".to_string(), 0, P::CONNECT_VOICE),
            (role, "role".to_string(), P::CONNECT_VOICE, 0),
        ];
        let p = apply_channel_overrides(P::CONNECT_VOICE | P::VIEW_CHANNEL, false, me, Some(&roles), Some(ev), &ov);
        assert!(p & P::CONNECT_VOICE != 0);

        // Sans ce rôle, le deny @everyone tient
        let p = apply_channel_overrides(P::CONNECT_VOICE | P::VIEW_CHANNEL, false, me, None, Some(ev), &ov);
        assert!(p & P::CONNECT_VOICE == 0);

        // L'override nominatif prime sur tout (sauf owner/admin)
        let mut ov2 = ov.clone();
        ov2.push((me, "member".to_string(), 0, P::CONNECT_VOICE));
        let p = apply_channel_overrides(P::CONNECT_VOICE, false, me, Some(&roles), Some(ev), &ov2);
        assert!(p & P::CONNECT_VOICE == 0);

        // Owner et ADMINISTRATOR ignorent les overrides
        assert_eq!(apply_channel_overrides(0, true, me, None, Some(ev), &ov2), i64::MAX);
        assert_eq!(apply_channel_overrides(P::ADMINISTRATOR, false, me, None, Some(ev), &ov2), i64::MAX);

        // STREAM (bit 40) survit au aller-retour i64
        let ov3 = vec![(ev, "role".to_string(), PERM_STREAM, 0)];
        assert!(apply_channel_overrides(0, false, me, None, Some(ev), &ov3) & PERM_STREAM != 0);
    }
}
