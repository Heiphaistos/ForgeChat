-- Orateur prioritaire retiré (2026-10-10) : le bit 18 n'a plus aucun effet ; on l'efface des
-- rôles et des surcharges de salon. Colonnes BIGINT : masque bigint explicite, les autres bits
-- (ADMINISTRATOR = 1<<31, STREAM = 1<<40) restent intacts. Bit réservé, jamais réattribué.
UPDATE roles SET permissions = permissions & ~(1::BIGINT << 18) WHERE permissions & (1::BIGINT << 18) <> 0;
UPDATE channel_permissions
   SET allow = allow & ~(1::BIGINT << 18), deny = deny & ~(1::BIGINT << 18)
 WHERE (allow | deny) & (1::BIGINT << 18) <> 0;
