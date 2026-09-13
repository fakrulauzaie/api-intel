# Governance

## Project model

Backend API Intelligence Engine starts as a single-maintainer project. The repository
owner is the final decision maker and release authority. This is deliberately modest:
publication does not create a promise of roadmap delivery, continuous availability, or
maintainer capacity.

Current ownership is recorded in [MAINTAINERS.md](MAINTAINERS.md) and enforced for the
public repository through `CODEOWNERS` review plus protected release credentials.

## Roles

- **Owner/maintainer:** triages reports, reviews and merges changes, changes public
  contracts, manages releases and security advisories, and may delegate scoped access.
- **Contributor:** proposes issues or signed-off changes under the contribution policy;
  contribution does not grant merge, release, or representation authority.
- **Reviewer:** a contributor explicitly asked to review a change; the role is scoped to
  that review unless added to `MAINTAINERS.md`.

## Decision process

Routine fixes may be accepted through reviewed pull requests. Changes to canonical
schemas, proof semantics, public commands, supported-version claims, licensing,
security boundaries, release destinations, or governance require explicit maintainer
approval and the relevant executable gate. Significant durable architecture decisions
should receive an ADR; an ADR does not override current validators or tests.

Correctness and honest uncertainty take precedence over breadth. When evidence is
insufficient, the project should retain a diagnostic or unsupported state rather than
approve an inference by convention.

## Releases and credentials

Only the owner may authorize a release. CI checks may assemble a candidate but cannot
grant publication authority. Package, repository, Action, and container credentials
must be least-privilege, independently revocable, and unavailable to untrusted pull-
request code.

## Changes to governance

Governance changes are reviewed like other public contracts and recorded in the
changelog. Adding a maintainer requires their consent, an explicit scope, and an access
review. Removing an inactive or compromised maintainer may be immediate when needed to
protect users.

If the project becomes inactive, users may exercise the Apache-2.0 license and fork it;
no succession or trademark rights are implied. A future multi-maintainer model should
replace this file only after responsibilities and security escalation are operational.
