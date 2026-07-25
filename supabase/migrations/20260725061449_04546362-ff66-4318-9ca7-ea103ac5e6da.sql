
-- Mexico Legal Foundation: legal profiles + org profile link
CREATE TABLE public.legal_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  country text NOT NULL,
  language text NOT NULL DEFAULT 'es',
  legal_system text NOT NULL,
  jurisdictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  practice_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_lock text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.legal_profiles TO authenticated, anon;
GRANT ALL ON public.legal_profiles TO service_role;
ALTER TABLE public.legal_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "legal_profiles_public_read" ON public.legal_profiles FOR SELECT USING (true);
CREATE TRIGGER trg_legal_profiles_updated BEFORE UPDATE ON public.legal_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Link organizations to a legal profile (default: Mexico)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS legal_profile_code text NOT NULL DEFAULT 'MX';

-- Seed the Mexico legal profile
INSERT INTO public.legal_profiles (code, name, country, language, legal_system, jurisdictions, primary_sources, practice_areas, prompt_lock)
VALUES (
  'MX',
  'México — Sistema Jurídico Nacional',
  'MX',
  'es',
  'Civil Law (tradición romano-germánica)',
  '["Federal","CDMX","Aguascalientes","Baja California","Baja California Sur","Campeche","Chiapas","Chihuahua","Coahuila","Colima","Durango","Estado de México","Guanajuato","Guerrero","Hidalgo","Jalisco","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca","Puebla","Querétaro","Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco","Tamaulipas","Tlaxcala","Veracruz","Yucatán","Zacatecas"]'::jsonb,
  '["Constitución Política de los Estados Unidos Mexicanos","Código Nacional de Procedimientos Penales","Código Penal Federal","Código Civil Federal","Código de Comercio","Ley Federal del Trabajo","Ley de Amparo","Ley Federal de Protección de Datos Personales en Posesión de los Particulares","Ley General de Sociedades Mercantiles","Jurisprudencia SCJN","Diario Oficial de la Federación","Semanario Judicial de la Federación"]'::jsonb,
  '["Penal","Civil","Mercantil","Laboral","Familiar","Amparo / Constitucional","Administrativo","Corporativo","Fiscal","Migratorio","Propiedad Intelectual","Datos Personales"]'::jsonb,
  'Operas exclusivamente dentro del sistema jurídico mexicano (tradición civil romano-germánica). PROHIBIDO usar conceptos, terminología, tribunales, procedimientos o precedentes del sistema estadounidense (common law) o de cualquier otra jurisdicción. Nunca uses términos como: felony, misdemeanor, plea bargain, grand jury, discovery, tort, summary judgment, hearsay, Miranda, indictment, prosecutor (en lugar de Ministerio Público o Fiscalía), district attorney, jury trial. Usa siempre terminología mexicana: Ministerio Público, Fiscalía, imputado, carpeta de investigación, vinculación a proceso, medidas cautelares, auto de apertura a juicio, juicio oral, amparo, demandado, actor, jurisprudencia, tesis aislada, SCJN, TFJA, DOF. Fundamenta cada análisis en fuentes mexicanas: CPEUM, CNPP, Código Penal Federal, códigos estatales, LFT, Ley de Amparo, jurisprudencia de la SCJN. Si una autoridad no puede verificarse, márcala como no verificada y solicita revisión humana.'
);

-- Seed core Mexican legal authorities
INSERT INTO public.legal_authorities (kind, jurisdiction, title, short_title, issuer, citation, source_url, body) VALUES
('constitution','Federal','Constitución Política de los Estados Unidos Mexicanos','CPEUM','Congreso Constituyente','CPEUM','https://www.diputados.gob.mx/LeyesBiblio/pdf/CPEUM.pdf','Norma suprema del ordenamiento jurídico mexicano.'),
('code','Federal','Código Nacional de Procedimientos Penales','CNPP','Congreso de la Unión','CNPP','https://www.diputados.gob.mx/LeyesBiblio/pdf/CNPP.pdf','Regula el sistema penal acusatorio en toda la República.'),
('code','Federal','Código Penal Federal','CPF','Congreso de la Unión','CPF','https://www.diputados.gob.mx/LeyesBiblio/pdf/CPF.pdf','Tipifica delitos del orden federal.'),
('code','Federal','Código Civil Federal','CCF','Congreso de la Unión','CCF','https://www.diputados.gob.mx/LeyesBiblio/pdf/CCF.pdf','Regula relaciones civiles del orden federal.'),
('code','Federal','Código de Comercio','CCom','Congreso de la Unión','CCom','https://www.diputados.gob.mx/LeyesBiblio/pdf/CCom.pdf','Regula actos y contratos mercantiles.'),
('law','Federal','Ley Federal del Trabajo','LFT','Congreso de la Unión','LFT','https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf','Regula las relaciones laborales conforme al Art. 123 CPEUM.'),
('law','Federal','Ley de Amparo, Reglamentaria de los Artículos 103 y 107 de la CPEUM','Ley de Amparo','Congreso de la Unión','Ley de Amparo','https://www.diputados.gob.mx/LeyesBiblio/pdf/LAmp.pdf','Regula el juicio de amparo directo e indirecto.'),
('law','Federal','Ley Federal de Protección de Datos Personales en Posesión de los Particulares','LFPDPPP','Congreso de la Unión','LFPDPPP','https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf','Protección de datos personales tratados por particulares.'),
('law','Federal','Ley General de Sociedades Mercantiles','LGSM','Congreso de la Unión','LGSM','https://www.diputados.gob.mx/LeyesBiblio/pdf/LGSM.pdf','Regula la constitución y operación de sociedades mercantiles.'),
('law','Federal','Código Fiscal de la Federación','CFF','Congreso de la Unión','CFF','https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf','Regula contribuciones federales y procedimientos fiscales.'),
('code','Yucatán','Código Penal del Estado de Yucatán','CP Yuc.','Congreso del Estado de Yucatán','CP Yuc.',NULL,'Tipifica delitos del fuero común en Yucatán.'),
('code','CDMX','Código Civil para el Distrito Federal','CCDF','Asamblea Legislativa CDMX','CCDF',NULL,'Regula relaciones civiles en la Ciudad de México.');
