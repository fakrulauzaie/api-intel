## Problem and scope

Describe the user problem and the intentionally bounded change.

## Proof-boundary change

State which fact becomes provable, which evidence proves it, and exactly where proof
still stops. Write “none” if analyzer semantics do not change.

## Verification

List focused and full checks run, with exact test counts where available.

## Checklist

- [ ] The change contains no credentials, private paths, client identifiers, or
      unauthorized source/artifacts.
- [ ] Positive, close-negative, ambiguity/unsupported, and `mustNotInfer` fixtures are
      included when static-analysis behavior changes.
- [ ] Canonical ordering, diagnostics, evidence, compatibility readers, and limits are
      covered where applicable.
- [ ] Current documentation, changelog, schema/migration notes, and compatibility claims
      match the implementation.
- [ ] New dependencies, copied material, generated bundles, and fixtures have reviewed
      license/provenance evidence.
- [ ] `pnpm run build`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and
      `pnpm run format:check` pass, or any omission is explained.
- [ ] Every commit carries a matching `Signed-off-by` trailer; every co-author is also
      signed off under the DCO policy.

## Artifact and release impact

List regenerated artifacts and affected version domains. This pull request does not
authorize publication.
