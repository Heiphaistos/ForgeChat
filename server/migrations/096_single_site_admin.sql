-- Un seul administrateur : le compte de FORGECHAT_ADMIN_EMAIL (voir handlers/site_admin.rs).
-- Le drapeau accordé par le premier panneau d'administration n'est plus jamais lu : on le remet à zéro.
UPDATE users SET is_site_admin = FALSE WHERE is_site_admin;
