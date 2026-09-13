# Public-Release Sanitation Record

Status: current tree sanitized; public-history strategy selected  
Audit date: 2026-09-10  
Project-owned material authorized by owner: yes  
Exact external publication action authorized: no

Phase O1.2 separates three inputs that must not be conflated:

1. the current Git candidate tree, including untracked files intended for this change;
2. the exact file list selected by `npm pack --dry-run --json --ignore-scripts`; and
3. every reachable commit in the local Git object graph.

The [owner attestation](ownership-and-publication-authorization.md) authorizes public
release of qualifying project-owned material in principle. It explicitly treats
permission to use organization systems for private target testing as distinct from,
and not evidence of, redistribution permission. Organization-derived material is
prohibited from every public surface; third-party obligations remain applicable.

The current tree replaces organization-derived service, broker, interaction, resource,
class, and job identifiers with a project-authored synthetic orders API/worker corpus.
The corpus retains co-located, producer-only, consumer-only, collision, ambiguous,
missing-topology, critical-section, distributed-conditional, and must-not-infer
contracts. Public command examples use repository-relative paths; local MCP host
examples use explicit `/absolute/path/to/...` placeholders instead of a contributor's
machine paths.

A target-specific P4 mutation harness was removed from the public candidate. It
depended on sibling repositories and edited one of their source files in place, so it
was neither a reproducible project test nor an appropriate public example. The pure
system comparison/impact contracts remain covered by repository-local unit fixtures.

The machine-readable [audit result](public-release-audit.json) contains only finding
categories, stable non-secret fingerprint IDs, and counts. It intentionally omits
matched values. High-confidence credential-shaped values used by adversarial tests are
allowed only at exact synthetic fixture paths. Generated GitHub/GitLab bundles have a
narrow path allowance for their compiled path-sanitization examples; their source and
all other credential categories remain audited.

## Selected history disposition

The read-only history audit found organization-derived identifiers in reachable
commits. No commit was changed, removed, rebased, filtered, or force-pushed.

On 2026-09-10 the owner selected a sanitized new public repository with fresh history.
The existing repository and all legacy refs remain private; its history will not be
rewritten, mirrored, or included in the public repository. The machine report keeps
the redacted legacy finding counts visible as `findings_detected` and records their
publication disposition as `excluded_by_selected_strategy`. It does not call that
history clean.

The detailed [public repository strategy](../public-repository-strategy.md) defines the
future staged-export and separation requirements. The selection completes Phase
O1.2's history decision, but execution is deferred to the audited alpha-release
workflow. This record does not authorize repository creation, visibility changes,
history rewriting, package publication, or release distribution.

`pnpm run audit:public:history` now exits successfully when this exact exclusion
policy remains valid. That exit status means the publication disposition is resolved;
it does not mean the legacy history has no findings. The command and JSON report always
print those states separately.

The machine report deliberately keeps `exactExternalPublicationAuthorized: false` and
the public-repository plan's `publicationAuthorized: false`. Those fields describe an
external mutation against an exact destination, not the recorded owner authorization
for qualifying project-owned source.

The audit policy and report use schema `1.1.0`; this revision adds the scoped owner-
authorization record and makes its exclusion conditions mandatory.
