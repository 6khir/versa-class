#!/bin/bash
cd "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )" || exit 1
pkill -f "node --test" 2>/dev/null; sleep 1
LOG="/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )/_versa_editable_proof.log"
echo "EDITABLE ENGINE PROOF — $(date)" > "$LOG"
node --test --test-timeout=15000 \
  tests/editable-page-contract.test.cjs \
  tests/editable-generation-adapters.test.cjs \
  tests/editable-engine-orchestrator.test.cjs \
  tests/editable-layout-resolver.test.cjs \
  tests/editable-pdf-composer.test.cjs \
  tests/editable-pptx-assembler.test.cjs \
  tests/editable-repository.test.cjs \
  tests/editable-page-revisions.test.cjs \
  tests/editable-production.test.cjs \
  tests/text-editable-engine.test.cjs \
  tests/pipeline-order.test.cjs >> "$LOG" 2>&1
echo "EXIT=$?" >> "$LOG"
echo "===SUMMARY===" >> "$LOG"
grep -E '^# (tests|pass|fail|cancelled|skipped)' "$LOG" >> "$LOG"
echo "PROOF DONE"
