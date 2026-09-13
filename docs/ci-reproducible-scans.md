# Reproducible CI Scan Recipe

Phase P2.2 defines a strict, provider-neutral manifest for proving that a baseline and
candidate evaluation came from compatible, reproducible scan inputs. It is a
preflight and artifact contract, not a checkout, dependency-install, scan, cache, or
CI-provider executor.

## Trust boundary

The CI wrapper owns workspace creation and all process execution. It must place the
trusted baseline and untrusted candidate in distinct, canonical workspaces. The
engine receives only validated artifacts and explicit provenance; it never resolves
branches or interpolates repository-derived text into a command.

A candidate job must run without a write token or secret. Its repository permission
is read-only, and it may read but never write the trusted baseline cache. Baseline
artifacts and cache entries are produced by a trusted writer and are addressed only
by immutable input hashes. A trusted prebuilt baseline artifact still records the
dependency lockfile and install-plan provenance from the scan that produced it.

The manifest records:

- the exact engine name, version, distribution hash, and structured Node.js range;
- the trusted configuration path, source-content hash, and effective analysis hash;
- each analysis ID, schema, result state, repository revision, toolchain, artifact
  hash, and source-file count;
- the package-manager name/version, lockfile path/hash, and fixed install command for
  both snapshots; and
- either an explicit topology hash or the explicit `not_applicable` state.

Node range text is validated against its structured minimum and exclusive maximum;
it cannot serve as an unchecked display label. Recipe IDs and baseline cache keys are
content-derived, and canonical serialization produces stable bytes.

## Dependency preparation

Phase P2.2 supports two deliberately narrow lockfile recipes:

| Lockfile            | Exact argument vector                                               |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm-lock.yaml`    | `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile` |
| `package-lock.json` | `npm ci --ignore-scripts`                                           |

The wrapper must invoke these as an executable plus an argument array, without a
shell or string interpolation. Both recipes reject lockfile drift and disable target
package lifecycle scripts. The pnpm recipe additionally disables repository-controlled
pnpm hook code. The manifest pins the package-manager version separately.
Yarn and package-manager-specific modes such as Plug'n'Play are not silently treated
as equivalent; support requires a later explicit contract.

Disabling scripts is a trust-boundary rule, not a guarantee that every target remains
analyzable. If a repository needs generated declarations from a lifecycle hook, the
candidate scan fails as `analysis_failure`; the wrapper must not retry with scripts or
pnpmfile hooks enabled. Package installation still downloads and processes dependencies, so it
belongs in an ephemeral, unprivileged runner with no secrets and ordinary operating
system/network containment.

The fixed commands follow the lockfile and lifecycle controls documented by
[pnpm install](https://pnpm.io/cli/install) and
[npm ci](https://docs.npmjs.com/cli/commands/npm-ci/).

## Compatible baseline verification

`createCiScanRecipe()` combines an already validated P2.1 evaluation with trusted
execution provenance. `verifyCiScanRecipe()` checks the exact evaluation and rejects
any stale or different repository revision, engine distribution, trusted project
configuration, effective analysis configuration, analysis schema/toolchain,
dependency lockfile, topology, or Node runtime.

Such a valid-but-different pair is `incompatible_baseline`. A malformed or tampered
manifest is `invalid_input`. Analysis failure, cancellation, configured
`policy_violation`, analysis completed with gaps, ordinary impact, and unknown policy
results retain the distinct P2.1 meanings; no adapter may collapse them into one
generic failure.

The baseline cache key depends only on trusted baseline inputs:

- baseline artifact and repository revision;
- baseline dependency lockfile hash;
- engine distribution hash;
- trusted project-configuration hash; and
- topology state/hash.

Candidate workspace names, lockfiles, and findings never influence that key and can
never authorize a cache write.

## Reference wrapper sequence

1. Pin and verify the engine distribution, Node runtime, package-manager versions,
   and trusted `api-intel.config.json`.
2. Resolve the baseline outside the engine into a separate trusted workspace, or
   retrieve a content-addressed trusted analysis artifact with complete recipe
   provenance.
3. Place candidate source in a new untrusted workspace with no secrets or write token.
4. Hash each lockfile, execute only its fixed no-scripts install argument vector, and
   scan each required snapshot using the same effective configuration.
5. Produce and validate comparison, impact, policy, and P2.1 evaluation documents.
6. Create, canonically serialize, and verify the P2.2 recipe before accepting or
   publishing any result.
7. Pass validated P2.1 renderings to later bounded provider adapters. Never publish
   arbitrary repository text as an annotation or comment.

Gate CK0 is closed at the contract/preflight layer. Native checkout, installation, and
publication remain outside this pure module: P3.1 and P3.2 now implement those effects
in shared-runner GitHub/GitLab adapters. Provider-managed cache APIs remain unimplemented.
