import { normalizeSourceAlias, type CanonicalSourceDocument } from "../intelligence/canonical-source-identity";

export function canonicalSourceCount(refs: ReadonlyArray<Record<string, any>>): number {
  return new Set(refs.map(r => r.canonical_source_id).filter((id): id is string => typeof id === "string" && !!id)).size;
}

/** Lookup only: identity is assigned by the existing normalization service. */
export function resolveReportSourceRefs(refs: ReadonlyArray<Record<string, any>>, sources: ReadonlyArray<CanonicalSourceDocument>) {
  const lookup = new Map<string, Set<string>>();
  const byId = new Map(sources.map(s => [s.canonical_source_id, s]));
  for (const s of sources) for (const value of [s.document_id, s.original_filename, s.display_name, ...(s.source_aliases ?? [])]) {
    if (!value) continue;
    const key = normalizeSourceAlias(value);
    const ids = lookup.get(key) ?? new Set<string>();
    ids.add(s.canonical_source_id);
    lookup.set(key, ids);
  }
  return refs.map(ref => {
    let id = byId.has(ref.canonical_source_id) ? ref.canonical_source_id : undefined;
    if (!id) {
      const ids = new Set<string>();
      for (const value of [ref.document_id, ref.doc_id, ref.source_document_id, ref.filename, ref.label, ref.source_name, ref.document_title, ref.doc_n ? "DOC " + ref.doc_n : null]) {
        for (const found of lookup.get(normalizeSourceAlias(value)) ?? []) ids.add(found);
      }
      if (ids.size === 1) id = [...ids][0];
    }
    const source = byId.get(id);
    return { ...ref, canonical_source_id: id ?? null,
      ...(source ? { filename: source.display_name || source.original_filename } : {}) };
  });
}
