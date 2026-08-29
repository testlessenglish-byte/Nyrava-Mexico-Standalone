import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const rootSource = readFileSync(join(root, "src", "routes", "__root.tsx"), "utf8");
const resourcesSource = readFileSync(join(root, "src", "routes", "resources.tsx"), "utf8");
const aboutSource = readFileSync(join(root, "src", "routes", "about.tsx"), "utf8");
const howItWorksSource = readFileSync(join(root, "src", "routes", "how-it-works.tsx"), "utf8");
const trustSource = readFileSync(join(root, "src", "routes", "trust.tsx"), "utf8");
const responsibleAiSource = readFileSync(join(root, "src", "routes", "responsible-ai.tsx"), "utf8");
const aiTransparencySource = readFileSync(join(root, "src", "routes", "ai-transparency.tsx"), "utf8");
const roadmapSource = readFileSync(join(root, "src", "routes", "roadmap.tsx"), "utf8");
const termsSource = readFileSync(join(root, "src", "routes", "terms.tsx"), "utf8");
const releaseNotesSource = readFileSync(join(root, "src", "routes", "release-notes.tsx"), "utf8");

describe("SEO - Canonical Mexican Spanish (es-MX) Metadata & Content Consistency", () => {
  it("sets root document html lang to es-MX", () => {
    expect(rootSource).toContain('<html lang="es-MX">');
  });

  it("ensures /resources metadata and sample report summaries are in Mexican Spanish", () => {
    expect(resourcesSource).toContain("Recursos — Informes de Muestra por Materia Jurídica | Nyrava México");
    expect(resourcesSource).toContain("Informes de muestra anonimizados en materias del derecho mexicano");
    expect(resourcesSource).toContain("Análisis del artículo 16 constitucional");
    expect(resourcesSource).toContain("Reconstrucción de la secuencia del siniestro");
    expect(resourcesSource).toContain("Responsabilidad médica — urgencias y diagnóstico tardío");
    expect(resourcesSource).toContain("Despido injustificado con reclamo de hostigamiento");
    expect(resourcesSource).toContain("Amparo directo — cuestiones probatorias y constitucionales");
    expect(resourcesSource).toContain("Resolución determinante y juicio de nulidad ante el TFJA");
    expect(resourcesSource).toContain("Disputa contractual mercantil con reconvención");
    // Ensure English summaries were completely replaced
    expect(resourcesSource).not.toContain("Analysis of article 16 CPEUM");
    expect(resourcesSource).not.toContain("Reconstruction of the crash sequence");
  });

  it("ensures /about metadata is in Mexican Spanish", () => {
    expect(aboutSource).toContain("Acerca de Nyrava");
    expect(aboutSource).not.toContain("About Nyrava — Legal Intelligence OS");
  });

  it("ensures /how-it-works metadata and content are in Mexican Spanish", () => {
    expect(howItWorksSource).toContain("Cómo Funciona — Nyrava México");
    expect(howItWorksSource).toContain("Cómo Funciona — Nyrava Inteligencia Jurídica");
    expect(howItWorksSource).toContain("1. Ingesta y Clasificación por Materia");
    expect(howItWorksSource).toContain("2. Extracción y Compuerta de Evidencia");
    expect(howItWorksSource).toContain("3. Actualizaciones Incrementales del Expediente");
    expect(howItWorksSource).toContain("4. Flujo de Atención Integral (Trabajo Social)");
    expect(howItWorksSource).toContain("5. Privacidad Multinivel y Consentimiento Informado");
    expect(howItWorksSource).toContain("6. Control Humano y Responsabilidad Profesional");
    expect(howItWorksSource).not.toContain("How It Works — Nyrava");
    expect(howItWorksSource).not.toContain('heading="1. Ingest"');
  });

  it("ensures legal and trust pages have Mexican Spanish SEO metadata", () => {
    expect(trustSource).toContain("Centro de Confianza y Seguridad — Nyrava México");
    expect(responsibleAiSource).toContain("Política de IA Responsable — Nyrava México");
    expect(aiTransparencySource).toContain("Transparencia de Inteligencia Artificial — Nyrava México");
    expect(roadmapSource).toContain("Hoja de Ruta — Nyrava México");
    expect(termsSource).toContain("Términos de Servicio — Nyrava México");
    expect(releaseNotesSource).toContain("Notas de Versión — Nyrava México");
  });
});
