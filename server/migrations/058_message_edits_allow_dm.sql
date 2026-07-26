-- CRITICAL: edit_dm_message (friends.rs) has always tried to insert into
-- message_edits using a dm_messages.id as message_id -- message_edits.message_id
-- had a straight FK to messages(id) (migration 008), so this INSERT ALWAYS
-- violated the constraint (23503), causing the entire edit request to 500.
-- Editing a DM message has never worked, not even once, since this feature was
-- written. Same structural fix as migrations 056/057.
ALTER TABLE message_edits DROP CONSTRAINT IF EXISTS message_edits_message_id_fkey;
