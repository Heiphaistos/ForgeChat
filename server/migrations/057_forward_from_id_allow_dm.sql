-- forward_message() (fixed to resolve source messages from either `messages`
-- or `dm_messages`, same reasoning as message_reminders in migration 056) hits
-- a straight FK when the source is a DM message: forward_from_id can now point
-- to either table (disjoint UUID spaces), so a single-table FK is wrong here
-- too. Confirmed in prod: forwarding a DM message failed with
-- "insert or update on table messages violates foreign key constraint
-- messages_forward_from_id_fkey" (23503) the moment the ownership check was
-- fixed to actually allow the request through.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_forward_from_id_fkey;
