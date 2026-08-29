-- 20260829003500_cleanup_legacy_prototype_tables.sql
-- Clean removal of verified empty legacy prototype and demo tables

DROP TABLE IF EXISTS public.matter_knowledge CASCADE;
DROP TABLE IF EXISTS public.matter_tasks CASCADE;
DROP TABLE IF EXISTS public.matter_events CASCADE;
DROP TABLE IF EXISTS public.matter_notes CASCADE;
DROP TABLE IF EXISTS public.matters CASCADE;
DROP TABLE IF EXISTS public.social_sales_demo_records CASCADE;
