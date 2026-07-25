-- Webhook/GitHub-integration messages were stored with user_id = the webhook's
-- creator (or the server owner for GitHub push events), and the correct pseudonymous
-- label only existed in the one-shot WS broadcast payload at post time. Any later
-- read (channel reload, search, pins, mentions) joined straight to users.username,
-- silently showing the real human account instead of the webhook/bot name.
ALTER TABLE messages ADD COLUMN webhook_display_name TEXT;
