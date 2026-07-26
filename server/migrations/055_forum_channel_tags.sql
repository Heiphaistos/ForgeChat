-- ChannelSettingsModal.tsx already had a full UI for configuring a forum channel's
-- available tags + default sort + "require a tag" toggle -- calling
-- GET/POST/DELETE /channels/:id/tags and sending default_sort/require_tag in the
-- main channel PATCH. None of it ever existed on the backend: the tags routes were
-- never registered, and default_sort/require_tag were silently dropped by serde
-- (unknown JSON fields). Tags "added" in the UI only ever lived in local React state
-- and vanished the moment the modal was reopened.
CREATE TABLE forum_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, name)
);

ALTER TABLE channels ADD COLUMN default_sort TEXT NOT NULL DEFAULT 'latest_activity';
ALTER TABLE channels ADD COLUMN require_tag BOOLEAN NOT NULL DEFAULT false;
