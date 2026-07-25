-- Attorney Notes: a private per-motion scratchpad, editable alongside the
-- motion but never part of body_markdown — so it can never accidentally
-- end up in the exported PDF, Print, or Copy output, all of which read
-- body_markdown only. Nullable/default-empty, same table (no need for a
-- separate table — this is 1:1 with the draft row it annotates and has no
-- independent lifecycle).
ALTER TABLE public.case_motion_drafts
  ADD COLUMN attorney_notes text NOT NULL DEFAULT '';
