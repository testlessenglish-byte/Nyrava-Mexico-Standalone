// Tribunal Federal de Justicia Administrativa connector — STUB ONLY.
//
// Per NLKN build discipline: this is architecture, not a working fetch
// implementation. Nobody on this build has inspected Tribunal Federal de Justicia Administrativa's actual site
// structure or confirmed whether it exposes any machine-readable interface
// (API, RSS, structured downloads) versus HTML-only. Every data method
// throws until that inspection happens and a real implementation replaces
// it — see dof.connector.ts / scjn.connector.ts for what "real" looks like
// once a source has actually been verified.
//
// To activate: inspect https://www.tfja.gob.mx (or its known consulta de
// sentencias / boletín pages, if any) from an environment with real
// network access, document
// the actual endpoint/format found, then implement discover/sync/
// fetchUpdates/fetchDocument against that confirmed shape. Leave
// legal_source_connectors.status='planned' until legal_ingest_runs shows
// real rows from a live run.

import type {
  LegalSourceConnector,
  IngestedDocument,
  ExtractedArticle,
  ExtractedCitation,
  ValidationResult,
  ConnectorHealth,
} from "./types";
import { extractCitationsFromText } from "./citation-extract";

const NOT_IMPLEMENTED =
  "tfja.connector.ts is a stub — TFJA's real endpoint/data shape has not been inspected yet. See file header.";

export const tfjaConnector: LegalSourceConnector = {
  code: "tfja",
  displayName: "Tribunal Federal de Justicia Administrativa",
  kind: "administrative_ruling",
  accessMethod: "html_scrape", // placeholder — replace once a real interface is confirmed
  auth: { kind: "none" },

  async discover() {
    throw new Error(NOT_IMPLEMENTED);
  },
  async sync(): Promise<IngestedDocument[]> {
    throw new Error(NOT_IMPLEMENTED);
  },
  async fetchUpdates(_since: Date | null): Promise<IngestedDocument[]> {
    throw new Error(NOT_IMPLEMENTED);
  },
  async fetchDocument(_externalId: string): Promise<IngestedDocument> {
    throw new Error(NOT_IMPLEMENTED);
  },
  async extractMetadata(doc: IngestedDocument): Promise<Partial<IngestedDocument>> {
    return { title: doc.title, sourceUrl: doc.sourceUrl };
  },
  async extractArticles(_doc: IngestedDocument): Promise<ExtractedArticle[]> {
    return [];
  },
  async extractCitations(doc: IngestedDocument): Promise<ExtractedCitation[]> {
    return extractCitationsFromText(doc.rawText);
  },
  async normalize(doc: IngestedDocument): Promise<IngestedDocument> {
    return doc;
  },
  async validate(_doc: IngestedDocument): Promise<ValidationResult> {
    return { valid: false, errors: ["stub connector — not yet implemented"] };
  },
  async healthCheck(): Promise<ConnectorHealth> {
    return { connectorCode: "tfja", ok: false, checkedAt: new Date().toISOString(), detail: "stub — not implemented" };
  },
};
