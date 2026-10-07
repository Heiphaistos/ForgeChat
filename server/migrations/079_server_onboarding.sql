-- Onboarding de serveur : questions posées aux nouveaux membres, chaque réponse
-- donne des rôles et/ou rend visibles des salons.
CREATE TABLE IF NOT EXISTS onboarding_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    multiple BOOLEAN NOT NULL DEFAULT FALSE,
    position INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS onboarding_questions_server ON onboarding_questions(server_id);

CREATE TABLE IF NOT EXISTS onboarding_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES onboarding_questions(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    position INT NOT NULL DEFAULT 0,
    role_ids UUID[] NOT NULL DEFAULT '{}',
    channel_ids UUID[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS onboarding_options_question ON onboarding_options(question_id);

-- Réponses d'un membre : supprimées avec son adhésion (départ, expulsion, bannissement).
CREATE TABLE IF NOT EXISTS onboarding_responses (
    user_id UUID NOT NULL,
    server_id UUID NOT NULL,
    option_id UUID NOT NULL REFERENCES onboarding_options(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, option_id),
    FOREIGN KEY (user_id, server_id) REFERENCES server_members(user_id, server_id) ON DELETE CASCADE
);

-- NULL tant que le membre n'a pas répondu (ou passé) les questions.
ALTER TABLE server_members ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
