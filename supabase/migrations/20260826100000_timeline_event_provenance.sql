-- Timeline provenance and event typing. Main chronology rows are case events;
-- authority and legislative dates are rejected before persistence.

ALTER TABLE public.case_timeline_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'case_event',
  ADD COLUMN IF NOT EXISTS source_quote text;

ALTER TABLE public.case_timeline_events
  DROP CONSTRAINT IF EXISTS case_timeline_events_event_type_check;

ALTER TABLE public.case_timeline_events
  ADD CONSTRAINT case_timeline_events_event_type_check CHECK (
    event_type IN (
      'case_event', 'authority_date', 'legislative_history',
      'background_reference', 'unknown'
    )
  );

COMMENT ON COLUMN public.case_timeline_events.event_type IS
  'Context classification for the date. Canonical primary chronology persists case_event only.';
COMMENT ON COLUMN public.case_timeline_events.source_quote IS
  'Grounded passage used to classify the date and event context.';

-- Existing RLS policies remain unchanged and continue to scope timeline rows
-- through case ownership.
