ALTER TABLE public.case_perspectives DROP CONSTRAINT IF EXISTS case_perspectives_perspective_check;
ALTER TABLE public.case_perspectives ADD CONSTRAINT case_perspectives_perspective_check
  CHECK (perspective = ANY (ARRAY[
    'ministerio_publico','defensa','juzgador','independiente',
    'quejoso','autoridad_responsable','parte_actora','parte_demandada',
    'victima','tercero_interesado',
    'defense','prosecution','plaintiff','respondent','appellate','jury','independent'
  ]));