# Public Repository Strategy

Status: implemented for the first public alpha  
Decision date: 2026-09-10  
Execution date: 2026-09-13  
External repository created: yes  
Project-owned material authorized by owner: yes  
Exact external publication action authorized: yes

The first public release uses a **new, sanitized repository with fresh history** at
[`fakrulauzaie/api-intel`](https://github.com/fakrulauzaie/api-intel).
The existing implementation repository and its reachable commit graph will remain
private. This is a publication-boundary decision, not an assertion that the legacy
history is clean.

## Required separation

The following actions are prohibited by this decision:

- changing the visibility of the private source repository;
- pushing or mirroring its existing refs to a public remote;
- repointing its current `origin` to a public repository;
- rewriting, filtering, rebasing, or force-pushing its history; and
- treating a passing current-tree scan as permission to publish.

The read-only history audit retains its redacted finding counts. Those findings are
classified as `findings_detected` with an
`excluded_by_selected_strategy` publication disposition. They are never relabelled as
clean or erased merely because that history will not be published.

## Public-candidate procedure

Repository creation used the audited alpha-release workflow and explicit authorization
naming the exact destination. Phase O5.1:

1. pin the approved private source revision after all earlier productization gates;
2. export an allowlisted source tree into a separate staging directory without `.git`,
   ignored outputs, credentials, private fixtures, organization-derived material, or
   internal-only material;
3. run the current-tree audit against the staged files and the exact npm, CI, and OCI
   candidates derived from them;
4. freeze checksums, dependency/license evidence, release notes, and the distribution
   manifest; and
5. initialize fresh Git history only inside the approved staging tree.

O5.2 created the repository without importing legacy refs, enabled GitHub Private
Vulnerability Reporting, and published the private conduct contact required by
`CODE_OF_CONDUCT.md`. Issue intake remains disabled until the DCO status check and the
remaining hosted release gates are operational.

The first public commit starts the public project's lineage. Release notes and
provenance records may describe earlier private development factually, but must not
claim that the excluded commits are part of public history.

## Ongoing maintenance boundary

Private and public repositories must keep distinct remotes and histories. Changes
intended for public release should cross the boundary through a reviewed, reproducible
source export. Security fixes should be applied to the private source first and then
exported as a sanitized public change; blindly cherry-picking private commits is not a
safe synchronization mechanism.

This execution resolves Phase O1.2's history-strategy decision and repository-creation
step. It does not claim that an npm package, OCI image, GitLab component, or named
browser matrix exists; each remains controlled by its own release gate.

The owner's publication authorization applies to qualifying project-owned material,
not to organization systems used as private testing targets. Testing permission never
crosses this boundary as source, data, identifiers, topology, screenshots, artifacts,
or business details. Unknown derivation blocks export until the material is removed or
replaced with an independently authored synthetic equivalent.
