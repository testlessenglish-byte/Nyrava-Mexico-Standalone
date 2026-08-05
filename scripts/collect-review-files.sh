#!/usr/bin/env bash
# Export selected source files into Markdown bundles for external code review.
# Usage: bash scripts/collect-review-files.sh [output-dir]
# Secrets are never included: only source files listed below are read.

set -euo pipefail

OUT_DIR="${1:-code-review}"
mkdir -p "$OUT_DIR"

emit() { # emit <output-file> <title> <file...>
  local out="$OUT_DIR/$1"; shift
  local title="$1"; shift
  printf '# %s\n\n' "$title" > "$out"
  printf '_Repository: nyrava-mexico. Generated %s._\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$out"
  for f in "$@"; do
    if [[ -f "$f" ]]; then
      local ext="${f##*.}"
      case "$ext" in
        ts|tsx) lang="typescript" ;;
        js|jsx) lang="javascript" ;;
        sql) lang="sql" ;;
        json) lang="json" ;;
        md) lang="markdown" ;;
        *) lang="$ext" ;;
      esac
      {
        printf '# File: `%s`\n\n' "$f"
        printf '```%s\n' "$lang"
        cat "$f"
        printf '\n```\n\n'
      } >> "$out"
    else
      printf '# Missing file: `%s`\n\n' "$f" >> "$out"
    fi
  done
  echo "wrote $out ($(wc -c < "$out") bytes)"
}

# 01 — repository inventory
find src supabase/migrations tests -type f \
  ! -path '*/node_modules/*' | sort > "$OUT_DIR/01-repository-tree.txt"
echo "wrote $OUT_DIR/01-repository-tree.txt"

emit "02-work-product-code.md" "Work Product Generation" \
  src/lib/jurisdiction/mx-work-product.ts \
  src/lib/intelligence/work-product-verify.server.ts \
  src/lib/intelligence/motion-draft.server.ts \
  src/lib/intelligence/prose-polish.server.ts \
  src/lib/export-legal-memo.ts

emit "03-prompts-and-context.md" "Prompts, Mexico Lock and Model Context" \
  src/lib/mexico-lock.ts \
  src/lib/intelligence/report-canonical-context.ts \
  src/lib/intelligence/case-state.server.ts \
  src/lib/intelligence/corpus-snapshot.server.ts \
  src/lib/ai-key-router.server.ts \
  src/lib/groq.server.ts

emit "04-findings-and-citations.md" "Findings, Dedupe, Citations and Grounding" \
  src/lib/intelligence/findings.server.ts \
  src/lib/intelligence/finding-dedupe.ts \
  src/lib/intelligence/finding-selection.ts \
  src/lib/intelligence/canonical-id.ts \
  src/lib/intelligence/grounding.server.ts \
  src/lib/intelligence/hallucination.server.ts \
  src/lib/intelligence/citation-audit.server.ts \
  src/lib/intelligence/authority.ts

emit "05-report-and-pipeline.md" "Report Building, Suppression, Classification and Orchestration" \
  src/lib/execution/canonical.ts \
  src/lib/execution/mx-pipeline.ts \
  src/lib/execution/service.server.ts \
  src/lib/intelligence/sufficiency.server.ts \
  src/lib/intelligence/report-augment.server.ts \
  src/lib/intelligence/report-normalize.ts \
  src/lib/intelligence/report-quality-gate.ts \
  src/lib/intelligence/report-recommendations.ts \
  src/lib/mx-case-classifier.ts \
  src/lib/intelligence/practice-areas.ts \
  src/lib/jurisdiction/mexico-modules.ts \
  src/lib/agents/orchestrator.server.ts \
  src/lib/pipeline-runner.server.ts

emit "06-engines.md" "Engine Implementations" \
  src/lib/intelligence/engines.server.ts \
  src/lib/intelligence/derived-engines.server.ts \
  src/lib/intelligence/evidence-map.server.ts \
  src/lib/intelligence/cross-domain.server.ts \
  src/lib/intelligence/procedural-compliance.ts \
  src/lib/intelligence/jurisdiction-intel.server.ts

emit "07-schemas-and-tests.md" "Types, Schemas and Tests" \
  src/lib/intelligence/types.ts \
  src/lib/intelligence/gold-schema.ts \
  src/lib/jurisdiction/mexico-types.ts \
  src/lib/agents/types.ts \
  src/lib/intelligence/__tests__/finding-dedupe.test.ts

emit "08-pipeline-server.md" "Pipeline Orchestrator (large)" \
  src/lib/pipeline.server.ts

echo "Done. Files in $OUT_DIR/"
