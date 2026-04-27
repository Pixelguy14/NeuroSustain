-- ============================================================
-- NeuroSustain — Database Schema
-- Multi-tenant profile, session, and rating persistence
-- ============================================================

-- Step 1: Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 2: Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    locale TEXT DEFAULT 'en',
    total_sessions INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_session_date DATE,
    audio_focus_ambience BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 3: Sessions Table
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id TEXT UNIQUE NOT NULL, -- Logical ID from client
    exercise_type TEXT NOT NULL,
    pillar TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    duration_ms INTEGER,
    accuracy REAL,
    mean_rt_ms REAL,
    cv_rt REAL,
    focus_score REAL,
    mean_difficulty REAL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 4: Ratings Table
CREATE TABLE IF NOT EXISTS public.ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    pillar TEXT NOT NULL,
    rating REAL NOT NULL,
    rd REAL NOT NULL,
    volatility REAL NOT NULL,
    last_updated BIGINT NOT NULL,
    UNIQUE(profile_id, pillar)
);

-- Step 5: Trials Table (Optional, for deep analysis)
CREATE TABLE IF NOT EXISTS public.trials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT NOT NULL, -- Links to sessions table via session_id
    exercise_type TEXT NOT NULL,
    pillar TEXT NOT NULL,
    timestamp BIGINT NOT NULL,
    is_correct BOOLEAN NOT NULL,
    reaction_time_ms REAL NOT NULL,
    difficulty INTEGER NOT NULL,
    metadata JSONB
);

-- Step 6: Enable RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trials ENABLE ROW LEVEL SECURITY;

-- Step 7: Policies (Cleanup first to avoid duplication errors)
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can view their own ratings" ON public.ratings;
DROP POLICY IF EXISTS "Users can manage their own ratings" ON public.ratings;
DROP POLICY IF EXISTS "Users can view their own trials" ON public.trials;
DROP POLICY IF EXISTS "Users can insert their own trials" ON public.trials;

-- Step 8: Recreate Policies
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own sessions" ON public.sessions FOR SELECT USING (
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);
CREATE POLICY "Users can insert their own sessions" ON public.sessions FOR INSERT WITH CHECK (
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Users can view their own ratings" ON public.ratings FOR SELECT USING (
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);
CREATE POLICY "Users can manage their own ratings" ON public.ratings FOR ALL USING (
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
);

CREATE POLICY "Users can view their own trials" ON public.trials FOR SELECT USING (
    session_id IN (SELECT session_id FROM public.sessions WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()))
);
CREATE POLICY "Users can insert their own trials" ON public.trials FOR INSERT WITH CHECK (
    session_id IN (SELECT session_id FROM public.sessions WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid()))
);
