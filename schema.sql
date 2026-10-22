-- ============================================================
-- Tambua Chakula App - Database Schema
-- Inafanya kazi na: Neon, Supabase (PostgreSQL mode), Railway,
--                   Render PostgreSQL, au PostgreSQL yoyote
-- ============================================================

-- Watumiaji + akaunti zao
CREATE TABLE IF NOT EXISTS profiles (
    id              UUID PRIMARY KEY,
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       TEXT DEFAULT 'Mtumiaji',
    messages_used_today INTEGER DEFAULT 0,
    messages_limit      INTEGER DEFAULT 5,
    bonus_messages      INTEGER DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE,
    referral_count  INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admins (mstari mmoja kwa kila admin)
CREATE TABLE IF NOT EXISTS admins (
    user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE
);

-- Historia ya utambuzi wa vyakula
CREATE TABLE IF NOT EXISTS history (
    id         SERIAL PRIMARY KEY,
    user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
    food_name  TEXT,
    data       JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vipendwa (kila chakula kimoja kwa kila mtumiaji)
CREATE TABLE IF NOT EXISTS favorites (
    id         SERIAL PRIMARY KEY,
    user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
    food_name  TEXT,
    data       JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, food_name)
);

-- Mipangilio ya app (gemini key, default limit, referral bonus)
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- ============================================================
-- Admin wa kwanza: Badilisha 'your-user-uuid-here' na UUID ya
-- mtumiaji uliyejisajili kwanza, ukurasa wa Profiles kwenye DB
-- ============================================================
-- INSERT INTO admins (user_id) VALUES ('your-user-uuid-here');
