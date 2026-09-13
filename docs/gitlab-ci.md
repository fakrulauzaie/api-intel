# GitLab Merge-Request Gate

Phase P3.2 supplies a GitLab CI/CD component over the same provider-neutral scan and
evaluation runner used by the GitHub adapter. It scans isolated baseline and candidate
worktrees, publishes candidate file/line findings through GitLab's native Code Quality
report, retains the canonical evaluation and offline graph as downloadable artifacts,
and exits with the portable evaluation code. It does not create merge-request notes,
call the GitLab API, or require `CI_JOB_TOKEN` beyond GitLab Runner's ordinary checkout
behavior.

Phase P5.2 does not change that boundary. Its optional
[CI comment publisher](ci-comment-publisher.md) belongs in a separate trusted job with
a protected token; never expose that token to this candidate-analysis component.

The component source is [`../templates/api-intel/template.yml`](../templates/api-intel/template.yml),
and the consumer example is
[`examples/gitlab/api-intel-merge-request.yml`](examples/gitlab/api-intel-merge-request.yml).
Replace every placeholder and publish both the component commit and OCI image before
use.

## Why the component uses an OCI image

A GitLab component contributes pipeline YAML; it does not copy its repository files
into a consumer project's checkout. The adapter therefore runs from a separately
published OCI image. The component has a mandatory `image` input so there is no
mutable or fictitious default. Pin that input by `sha256` manifest digest and pin the
component include by a full commit SHA.

Build the checked-in distribution and an image from a reviewed, digest-pinned Node
base:

```powershell
pnpm run artifacts:write
pnpm run artifacts:check
docker build --build-arg NODE_IMAGE=node:22.14.0-bookworm-slim@sha256:VERIFIED_BASE_DIGEST --build-arg PNPM_VERSION=11.19.0 --build-arg NPM_VERSION=10.9.2 --file packaging/gitlab/Dockerfile --tag registry.example.com/api-intel:0.1.0-alpha.1 .
docker push registry.example.com/api-intel:0.1.0-alpha.1
```

The version tag above is only a temporary publication locator; it is not a supported
consumer reference. Resolve it immediately to the registry-reported immutable
manifest digest and use only that digest in the component input. The image defaults
to the dedicated unprivileged UID/GID `10001:10001`; target checkouts and the GitLab
builds directory must be readable/writable by that identity without granting
privileged-runner or host-socket access. The final image
contains Node, Git, exact npm/pnpm versions, the bundled adapter, and the pinned
`libpg-query` WASM parser and Cytoscape browser assets. The browser asset is colocated
with the bundled chunks so offline-graph generation does not depend on a separate
`node_modules` tree in the runtime image. The adapter fingerprints every emitted
loader, chunk, metadata, WASM, and browser-asset file for the P2.2 reproducibility
recipe. Both the component input regex and the runtime `CI_JOB_IMAGE` check reject a
mutable image reference; the resolved digest reference is retained in the GitLab
projection, manifest, and process result. The root `.dockerignore` limits image-build
context to the distribution and Dockerfile.

The ncc build generates `THIRD_PARTY_LICENSES.txt` and copies the project `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and deterministic dependency-license inventory into
`gitlab-dist/`; exact Cytoscape and libpg-query license texts are also copied under
`gitlab-dist/licenses/`. All are copied into the image and covered by the distribution
fingerprint. These files cover the adapter bundle and copied browser/WASM assets. They
do not replace the base image's Node/Debian notices or the per-image SBOM and
corresponding-source review required before publishing an OCI digest. See the
[redistribution audit](legal/redistribution-audit.md).

The repository release-artifact workflow performs a disposable image build, asserts
the configured and effective runtime UID, and starts the bundled adapter through an
invalid-input smoke. This does not replace a reviewed base-image digest, registry
manifest evidence, or the independently deferred GitLab-hosted component gate. See
[Reproducible Provider and Package Artifacts](reproducible-release-artifacts.md).

## Baseline and trust boundary

The job is eligible only when `CI_PIPELINE_SOURCE` is `merge_request_event`; the
adapter rejects every other source as well. `GIT_DEPTH` is fixed to `0`. The job
requires GitLab's exact `CI_MERGE_REQUEST_DIFF_BASE_SHA` and `CI_COMMIT_SHA`, verifies
both objects, and creates detached baseline and candidate worktrees in a fresh
job-specific directory beneath `CI_BUILDS_DIR`.

The baseline is deliberately the merge request's **diff base**, not a moving target-
branch name. This produces deterministic MR-diff semantics and avoids a branch-update
race. If the target branch advances, refresh the merge request pipeline to obtain its
new server-provided diff base.

Configuration always comes from the baseline worktree. The adapter resolves real
paths and rejects workspace escapes, shared worktrees, configuration outside the
baseline, lockfiles outside their worktree, and output paths through an existing
symbolic-link ancestor. It also refuses to publish if candidate content already
contains `.api-intel-gitlab`; this prevents a committed file or symlink from controlling
the report destination.

Target dependency installation uses only fixed argument arrays with no shell:

```text
pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
npm ci --ignore-scripts
```

The adapter checks exact package-manager versions, disables lifecycle scripts and
pnpmfile hooks, and never retries with scripts enabled. Only a small process
environment allowlist needed for execution, proxies, and certificate discovery is
passed to package managers. GitLab tokens, arbitrary project variables, and cloud
credentials are omitted. Target source is parsed but never imported or started.

Dependency retrieval and TypeScript parsing still consume untrusted data. Use an
ephemeral, unprivileged container runner with appropriate network and resource limits;
do not expose protected variables, host sockets, credentials, or privileged runner
capabilities. A fork merge-request pipeline normally uses the fork project's config,
resources, and variables. A project member can instead start it in the parent context,
where GitLab warns that fork code can access parent resources. Do not use that path for
this gate unless the candidate and complete pipeline have been reviewed and the runner
still supplies no secrets.

## Native report projection

The root `gl-code-quality-report.json` is a UTF-8 JSON array without a byte-order mark.
Every entry contains only GitLab's supported fields:

- `description` and `check_name`;
- a deterministic SHA-256 `fingerprint`;
- `severity`: `blocker` for portable failures, `major` for warnings, and `info` for
  notices; and
- a normalized candidate-relative `location.path` without `./`, plus an exact
  `location.lines.begin`.

GitLab Code Quality cannot represent job-level or baseline-only findings. Those, unsafe
paths, and records beyond the configurable 500-item maximum are omitted from the
native report rather than assigned invented locations. Their count appears in the
escaped 64 KiB summary, and every source finding remains in `ci-evaluation.json` and
the other canonical artifacts.

`artifacts:reports:codequality` is uploaded by GitLab even when the job fails. The
component also uses `artifacts:when: always` and `artifacts:paths`, so the canonical
bundle remains directly browsable. Analysis/input failures publish a valid empty Code
Quality array and a process result; they never publish guessed findings.

## Inputs

`image` is mandatory. The other component defaults are:

| Input                                                    | Default                 | Contract                                    |
| -------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| `job-name`                                               | `api-intel`             | caller-selectable to prevent job collisions |
| `stage`                                                  | `test`                  | must already exist in the consumer pipeline |
| `entrypoint`                                             | bundled image path      | absolute reviewed path inside the image     |
| `configuration`                                          | `api-intel.config.json` | baseline-worktree-relative trusted config   |
| `baseline-package-manager` / `candidate-package-manager` | `pnpm`                  | `pnpm` or `npm` only                        |
| `*-package-manager-version`                              | `11.19.0`               | exact version already present in the image  |
| `*-lockfile`                                             | `pnpm-lock.yaml`        | relative to the corresponding worktree      |
| `max-findings`                                           | `500`                   | integer from 1 through 500                  |
| `artifact-expire-in`                                     | `1 week`                | GitLab duration accepted by instance policy |

For npm projects, select `npm`, use the npm version baked into the chosen image, and
set `package-lock.json`. Mixed managers are supported when explicitly declared.

## Artifacts and outcomes

The fixed publication root contains:

```text
.api-intel-gitlab/
  gl-code-quality-report.json
  gitlab-summary.md
  process-result.json
  evaluations/ci_evaluation-<digest>/
    api-intel-graph.html
    ci-evaluation.json
    ci-evaluation.md
    ci-scan-recipe.json
    diff.json
    gitlab-code-quality.json
    gitlab-summary.md
    impact.json
    manifest.json
    policy-results.json
```

`manifest.json` records byte lengths and SHA-256 content hashes for every other file
in its evaluation directory. The root Code Quality and summary files are stable paths
required by GitLab artifact metadata; the content-addressed directory is the canonical
download bundle.

| Outcome                 | Exit |
| ----------------------- | ---: |
| `success`               |    0 |
| `policy_violation`      |    8 |
| `analysis_failure`      |    6 |
| `invalid_input`         |   10 |
| `incompatible_baseline` |   11 |
| `canceled`              |  130 |

## GitLab.com and self-managed support

CI/CD components became generally available in GitLab 17.0. P3.2 claims GitLab 17.0+
only; older instances are outside the supported contract. A self-managed installation
must support `spec:inputs`, merge-request pipelines, the
`CI_MERGE_REQUEST_DIFF_BASE_SHA` predefined variable, Code Quality report artifacts,
and a container runner. Mirror the component and OCI image onto that instance and use
`$CI_SERVER_FQDN` plus its local registry; cross-instance component availability is not
assumed.

The source, projection, bundled-runtime smoke test, component contract, and colocated
Cytoscape asset are locally verified. The matching asset design has passed the GitHub
adapter's hosted run, but that is not evidence for GitLab image, component, or runner
behavior. Hosted GitLab.com release validation is explicitly deferred. A future claim
of hosted validation or publication to the CI/CD Catalog still requires a real
project/release, registry image manifest, CI Lint context, fork MR, and successful and
policy-violating MR pipelines. Until that gate is resumed and passes, the accurate
support statement is **locally verified GitLab adapter**, not hosted-validated.

Including the component in a repository CI file is an opt-in integration, not
tamper-proof enforcement: candidate changes can modify or remove project-owned CI
configuration. Enable the project's **Pipelines must succeed** merge check and, where
the GitLab tier and governance model permit it, inject the pinned component from a
separately controlled pipeline execution policy. Treat policy enforcement itself as a
deployment concern and test it in the hosted release gate; this adapter does not claim
that a present job cannot be bypassed by replacing the pipeline that declares it.
