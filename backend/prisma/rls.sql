-- Run once in the Supabase SQL editor, and again after any migration that adds tables.
-- Blocks Supabase's public data API from reading these tables. The API server connects as the postgres role, which bypasses RLS.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
