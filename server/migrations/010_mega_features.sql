-- Migration 010: Mega Features — User settings, soundboard, events, moderation, tasks

-- ─── User settings (persisté en DB, sync cross-device) ───────────────────────
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    font_family VARCHAR(100) NOT NULL DEFAULT 'Inter',
    font_size_px INTEGER NOT NULL DEFAULT 14 CHECK (font_size_px BETWEEN 10 AND 24),
    font_color VARCHAR(20),
    accent_color VARCHAR(20),
    bg_color VARCHAR(20),
    bg_image_url TEXT,
    interface_density VARCHAR(20) NOT NULL DEFAULT 'normal'
        CHECK (interface_density IN ('ultra-compact','compact','normal','comfortable')),
    emoji_style VARCHAR(20) NOT NULL DEFAULT 'native'
        CHECK (emoji_style IN ('native','twemoji')),
    time_format VARCHAR(5) NOT NULL DEFAULT '24h'
        CHECK (time_format IN ('12h','24h')),
    date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY',
    language VARCHAR(10) NOT NULL DEFAULT 'fr',
    gif_autoplay VARCHAR(10) NOT NULL DEFAULT 'always'
        CHECK (gif_autoplay IN ('always','hover','never')),
    link_preview BOOLEAN NOT NULL DEFAULT TRUE,
    code_theme VARCHAR(30) NOT NULL DEFAULT 'dracula',
    message_grouping_minutes INTEGER NOT NULL DEFAULT 5,
    avatar_shape VARCHAR(10) NOT NULL DEFAULT 'round'
        CHECK (avatar_shape IN ('round','square','rounded')),
    streamer_mode BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    reduce_motion BOOLEAN NOT NULL DEFAULT FALSE,
    high_contrast BOOLEAN NOT NULL DEFAULT FALSE,
    glassmorphism BOOLEAN NOT NULL DEFAULT FALSE,
    show_role_colors BOOLEAN NOT NULL DEFAULT TRUE,
    show_member_list_default BOOLEAN NOT NULL DEFAULT TRUE,
    sidebar_width_px INTEGER NOT NULL DEFAULT 240
        CHECK (sidebar_width_px BETWEEN 180 AND 400),
    pronouns VARCHAR(30),
    show_timestamps VARCHAR(20) NOT NULL DEFAULT 'hover'
        CHECK (show_timestamps IN ('always','hover','never')),
    message_display VARCHAR(20) NOT NULL DEFAULT 'normal'
        CHECK (message_display IN ('normal','compact','ultra-compact')),
    colorblind_mode VARCHAR(20) NOT NULL DEFAULT 'none'
        CHECK (colorblind_mode IN ('none','deuteranopia','protanopia','tritanopia')),
    dm_from_all BOOLEAN NOT NULL DEFAULT TRUE,
    show_online BOOLEAN NOT NULL DEFAULT TRUE,
    activity_visibility VARCHAR(20) NOT NULL DEFAULT 'everyone'
        CHECK (activity_visibility IN ('everyone','friends','nobody')),
    friend_request_from VARCHAR(20) NOT NULL DEFAULT 'everyone'
        CHECK (friend_request_from IN ('everyone','friends_of_friends','nobody')),
    explicit_content_filter VARCHAR(20) NOT NULL DEFAULT 'none'
        CHECK (explicit_content_filter IN ('none','members_without_roles','all')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Per-server notification overrides ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_overrides_server (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL DEFAULT 'inherit'
        CHECK (level IN ('all','mentions','nothing','inherit')),
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    muted_until TIMESTAMPTZ,
    UNIQUE(user_id, server_id)
);

CREATE TABLE IF NOT EXISTS notification_overrides_channel (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL DEFAULT 'inherit'
        CHECK (level IN ('all','mentions','nothing','inherit')),
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, channel_id)
);

-- ─── Connected accounts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connected_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform VARCHAR(30) NOT NULL,
    platform_username VARCHAR(100) NOT NULL,
    platform_url TEXT,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, platform)
);

-- ─── Keybindings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_keybindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    key_combo VARCHAR(50) NOT NULL,
    UNIQUE(user_id, action)
);

-- ─── Server soundboard ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS soundboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    emoji VARCHAR(10),
    file_url TEXT NOT NULL,
    volume REAL NOT NULL DEFAULT 1.0 CHECK (volume BETWEEN 0.0 AND 1.0),
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Server events (Teams-like meetings/events) ───────────────────────────────
CREATE TABLE IF NOT EXISTS server_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    event_type VARCHAR(20) NOT NULL DEFAULT 'event'
        CHECK (event_type IN ('event','meeting','stream','other')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url TEXT,
    max_attendees INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_attendees (
    event_id UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'interested'
        CHECK (status IN ('interested','going','not_going')),
    PRIMARY KEY (event_id, user_id)
);

-- ─── Modération avancée : notes sur les membres ───────────────────────────────
CREATE TABLE IF NOT EXISTS mod_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Timeouts (mutes temporaires — Teams/Discord style) ──────────────────────
CREATE TABLE IF NOT EXISTS user_timeouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(server_id, user_id)
);

-- ─── Tâches par canal (Teams-like) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date TIMESTAMPTZ,
    priority VARCHAR(10) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low','normal','high','urgent')),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Badges utilisateurs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_badges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_type VARCHAR(50) NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, badge_type)
);

-- ─── Config serveur étendue ───────────────────────────────────────────────────
ALTER TABLE servers ADD COLUMN IF NOT EXISTS afk_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS afk_timeout_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS system_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS rules_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS content_filter VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (content_filter IN ('none','members_without_roles','all_members'));
ALTER TABLE servers ADD COLUMN IF NOT EXISTS default_notification_level VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (default_notification_level IN ('all','mentions','nothing'));
ALTER TABLE servers ADD COLUMN IF NOT EXISTS vanity_url VARCHAR(30);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS server_category VARCHAR(50);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS boost_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS boost_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS raid_protection BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS require_2fa_for_moderation BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS server_locale VARCHAR(10) NOT NULL DEFAULT 'fr';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS max_video_channel_users INTEGER NOT NULL DEFAULT 25;

-- ─── Traductions de messages (cache) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_translations (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    language VARCHAR(10) NOT NULL,
    translated_text TEXT NOT NULL,
    translated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, language)
);

-- ─── Index performance ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS soundboard_server ON soundboard(server_id);
CREATE INDEX IF NOT EXISTS server_events_server ON server_events(server_id);
CREATE INDEX IF NOT EXISTS server_events_start ON server_events(start_time);
CREATE INDEX IF NOT EXISTS mod_notes_server_target ON mod_notes(server_id, target_user_id);
CREATE INDEX IF NOT EXISTS user_timeouts_expiry ON user_timeouts(expires_at);
CREATE INDEX IF NOT EXISTS channel_tasks_channel ON channel_tasks(channel_id);
CREATE INDEX IF NOT EXISTS connected_accounts_user ON connected_accounts(user_id);
CREATE INDEX IF NOT EXISTS notification_overrides_server_user ON notification_overrides_server(user_id);
