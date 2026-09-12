#!/bin/bash
cd "/Users/abdelmouiz/Desktop/VERSA SOFTWARE ( TPT )" || exit 1
echo "VERSA engine proof — $(date)" > _versa_test.log
echo "== EDITABLE engine + STATIC queue + store + verifiers ==" >> _versa_test.log
node --test tests/editable-page-contract.test.cjs tests/editable-page-revisions.test.cjs tests/editable-production.test.cjs tests/editable-repository.test.cjs tests/editable-generation-adapters.test.cjs tests/editable-engine-orchestrator.test.cjs tests/editable-layout-resolver.test.cjs tests/editable-pdf-composer.test.cjs tests/editable-pptx-assembler.test.cjs tests/text-editable-engine.test.cjs tests/pipeline-order.test.cjs tests/queue-engine.test.cjs tests/store.test.cjs tests/verifiers.test.cjs tests/pdf-export.test.cjs >> _versa_test.log 2>&1
echo "EXIT=$?" >> _versa_test.log
echo "done"
