-- Separate the procedural vehicle from the underlying materia. These are
-- additive, nullable fields; existing cases keep their current behavior until
-- grounded classification evidence is available.

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS procedural_vehicle text,
  ADD COLUMN IF NOT EXISTS underlying_materia text;

ALTER TABLE public.cases
  DROP CONSTRAINT IF EXISTS cases_underlying_materia_check,
  DROP CONSTRAINT IF EXISTS cases_procedural_vehicle_nonempty_check;

ALTER TABLE public.cases
  ADD CONSTRAINT cases_underlying_materia_check CHECK (
    underlying_materia IS NULL OR underlying_materia IN (
      'penal', 'civil', 'mercantil', 'familiar', 'laboral',
      'administrativo', 'fiscal', 'amparo', 'electoral', 'agrario',
      'constitucional', 'inmobiliario', 'ambiental', 'migratorio',
      'propiedad_intelectual', 'competencia_economica',
      'responsabilidad_medica'
    )
  ),
  ADD CONSTRAINT cases_procedural_vehicle_nonempty_check CHECK (
    procedural_vehicle IS NULL OR length(btrim(procedural_vehicle)) > 0
  );

ALTER TABLE public.case_classification_evidence
  DROP CONSTRAINT IF EXISTS case_classification_evidence_field_check;

ALTER TABLE public.case_classification_evidence
  ADD CONSTRAINT case_classification_evidence_field_check CHECK (
    field IN (
      'case_type', 'proceeding_type', 'procedural_vehicle',
      'underlying_materia', 'jurisdiction', 'matter', 'procedural_stage',
      'expediente_number', 'court', 'parties', 'concluded_status'
    )
  );

COMMENT ON COLUMN public.cases.procedural_vehicle IS
  'Grounded procedural vehicle, e.g. amparo_directo_revision or apelacion; independent from underlying_materia.';
COMMENT ON COLUMN public.cases.underlying_materia IS
  'Grounded underlying legal materia. A case may be procedurally Amparo while this remains penal.';

-- No policy changes are required. Existing cases RLS and
-- case_classification_evidence ownership policies continue to govern these
-- columns and rows.
