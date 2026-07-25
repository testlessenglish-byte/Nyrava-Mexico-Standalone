ALTER TABLE public.case_trial_prep ADD COLUMN IF NOT EXISTS penal_metrics jsonb;
COMMENT ON COLUMN public.case_trial_prep.penal_metrics IS 'Mexican sistema penal acusatorio (CNPP) outcome estimates: vinculacion_proceso_pct, sentencia_condenatoria_pct, sentencia_absolutoria_pct, procedimiento_abreviado_pct, recurso_exito_pct. No jury metrics exist in Mexican criminal procedure.';
COMMENT ON COLUMN public.case_trial_prep.jury_conviction_pct IS 'MX: sentencia condenatoria % before the Tribunal de Enjuiciamiento (legacy column name; no jury exists in MX criminal procedure).';
COMMENT ON COLUMN public.case_trial_prep.jury_acquittal_pct IS 'MX: sentencia absolutoria %.';
COMMENT ON COLUMN public.case_trial_prep.jury_appeal_pct IS 'MX: probability of success on recurso (apelacion / amparo directo).';
COMMENT ON COLUMN public.case_trial_prep.jury_settlement_pct IS 'MX penal: procedimiento abreviado / salida alterna %. Civil: settlement %.';