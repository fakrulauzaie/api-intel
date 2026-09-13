# Public Repository Strategy

Status: selected; execution deferred  
Decision date: 2026-09-10  
External repository created: no  
Project-owned material authorized by owner: yes  
Exact external publication action authorized: no

The first public release will use a **new, sanitized repository with fresh history**.
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

## Future public-candidate procedure

Repository creation belongs to the audited alpha-release workflow and requires a new,
explicit authorization naming the exact destination. Before that action, Phase O5.1
must:

1. pin the approved private source revision after all earlier productization gates;
2. export an allowlisted source tree into a separate staging directory without `.git`,
   ignored outputs, credentials, private fixtures, organization-derived material, or
   internal-only material;
3. run the current-tree audit against the staged files and the exact npm, CI, and OCI
   candidates derived from them;
4. freeze checksums, dependency/license evidence, release notes, and the distribution
   manifest; and
5. initialize fresh Git history only inside the approved staging tree.

Before enabling public participation, O5.2 must also publish and test the private
conduct-reporting contact required by `CODE_OF_CONDUCT.md`, create the public repository
without importing legacy refs, enable GitHub Private Vulnerability Reporting, verify
the repository's `SECURITY.md` path, and require the DCO status check. Issue intake must
remain disabled until those controls are operational.

The first public commit starts the public project's lineage. Release notes and
provenance records may describe earlier private development factually, but must not
claim that the excluded commits are part of public history.

## Ongoing maintenance boundary

Private and public repositories must keep distinct remotes and histories. Changes
intended for public release should cross the boundary through a reviewed, reproducible
source export. Security fixes should be applied to the private source first and then
exported as a sanitized public change; blindly cherry-picking private commits is not a
safe synchronization mechanism.

This selection resolves Phase O1.2's history-strategy decision. It does not complete
the remaining Public Trust Gate, create a repository, reserve a name, publish a
package, or authorize any external mutation.

The owner's publication authorization applies to qualifying project-owned material,
not to organization systems used as private testing targets. Testing permission never
crosses this boundary as source, data, identifiers, topology, screenshots, artifacts,
or business details. Unknown derivation blocks export until the material is removed or
replaced with an independently authored synthetic equivalent.
