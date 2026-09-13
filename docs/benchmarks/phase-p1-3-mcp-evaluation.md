# Phase P1.3 MCP Attribution Evaluation

Status: frozen synthetic baseline

Date: 2026-09-06

This evaluation checks the mechanics of artifact-grounded attribution. It is not a live
model benchmark, a comparison of AI vendors, or evidence for a universal reliability
multiplier.

## Corpus

`test/fixtures/mcp/p1-3-agent-evaluation.json` contains three representative questions:

1. endpoint-to-service/database effects;
2. conditional distributed producer/consumer correlation; and
3. the distinction between snapshot dependents and before/after blast radius.

Each case freezes supported claim IDs, dependency facts that a complete answer must
include, and allowed evidence IDs. It then records two deliberately controlled answer
shapes:

- `unsupportedUnaided` is a synthetic answer without artifact citations and with one
  unsupported relationship claim per case; and
- `artifactGrounded` contains only the frozen supported facts and their exact evidence.

Because these answers are fixtures rather than sampled model outputs, the result measures
the evaluator and grounding contract—not model quality.

## Metrics and result

| Answer fixture       | Citation accuracy | Omitted dependencies | False relationship claims |
| -------------------- | ----------------- | -------------------- | ------------------------- |
| `unsupportedUnaided` | not measurable    | 6                    | 3                         |
| `artifactGrounded`   | 100%              | 0                    | 0                         |

Citation accuracy is `valid citations / all citations`; it is `null` when an answer has
no citations. Omitted dependencies count required claim IDs absent from the answer.
False relationship claims count answer claim IDs outside the case's supported set.

Run the frozen evaluation with:

```powershell
pnpm run test -- test/unit/mcp/evaluation.test.ts
```

Future live-model evaluations must record the model/version, host, prompt, tool
availability, sampling settings, run count, and uncertainty separately. They must not
replace this deterministic contract fixture or be generalized beyond their measured
conditions.
