# GitHub Pull-Request Gate

Phase P3.1 packages the provider-neutral CI evaluation as a bundled composite GitHub
Action. It analyzes isolated baseline and candidate checkouts, writes a bounded job
summary and file annotations, uploads an exact content-addressed artifact directory,
then returns the portable evaluation exit code. It does not create or update pull-
request comments and does not call the GitHub API.

Phase P5.2 does not change that boundary. Its optional
[CI comment publisher](ci-comment-publisher.md) belongs in a separate trusted follow-up
job; never add its write token to this candidate-analysis action.

The reference workflow is
[`examples/github/api-intel-pull-request.yml`](examples/github/api-intel-pull-request.yml).
Replace its action owner, repository, and full commit SHA before use.

## Trust boundary

The supported trigger is ordinary `pull_request`. `pull_request_target` is rejected
before any checkout, package-manager, or analysis operation. The workflow grants only
`contents: read`, persists no checkout credentials, and passes no secrets to the
adapter. Fork candidate code therefore runs in the ordinary read-only pull-request
context.

The baseline and candidate must be separate directories beneath `GITHUB_WORKSPACE`.
The action resolves real paths and rejects escapes, shared directories, configuration
outside the baseline, lockfiles outside their checkout, and output outside the
workspace. Policy and analysis configuration always come from the trusted baseline;
candidate changes cannot weaken the current run's rules. Required `baseline-revision`
and `candidate-revision` inputs bind each analyzed Git `HEAD` to the exact PR base/head
SHA; a missing or different revision is rejected rather than compared.

The action invokes only `pnpm` or `npm`, with argument arrays and `shell: false`:

```text
pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile
npm ci --ignore-scripts
```

The declared package-manager version must exactly match the executable already on
`PATH`. Dependency lifecycle scripts and repository pnpmfile hooks remain disabled and
are never retried enabled.
Only a small environment allowlist required for process execution, proxying, and
certificate discovery reaches those installs; GitHub, Actions runtime, cloud, and
other arbitrary tokens are omitted. The analyzer parses target code but never imports
or starts it.

This boundary limits code execution; it does not make dependency retrieval harmless.
Use GitHub-hosted ephemeral runners or an equivalently isolated runner with egress and
resource controls appropriate for untrusted pull requests. Do not place credentials
in repository package-manager configuration.

## Pinning and distribution

`action.yml` launches `action-dist/index.js`, a checked-in ESM distribution produced
with exact development dependency `@vercel/ncc@0.45.0`. The build also copies the
pinned `libpg-query` WASM parser and `cytoscape@3.34.0` browser assets required by the
bundle. Both files are colocated with the emitted chunks because they are runtime file
loads, not JavaScript module imports that ncc can safely inline. A canonical
fingerprint covers every emitted loader, chunk, metadata, WASM, and browser-asset file.
The ncc build also generates `THIRD_PARTY_LICENSES.txt` and copies the project
`LICENSE`, `THIRD_PARTY_NOTICES.md`, and deterministic dependency-license inventory
into the output. These legal/evidence files are part of the canonical fingerprint.
Build the complete distribution after changing the action or any imported engine code:

```powershell
pnpm run artifacts:write
pnpm run artifacts:check
```

The second command independently rebuilds both provider distributions and compares
every byte with the reviewed outputs. `pnpm run action:controlled-smoke` then runs this
checked distribution against isolated frozen baseline/candidate repositories; the
target never supplies the action implementation. See
[Reproducible Provider and Package Artifacts](reproducible-release-artifacts.md).

Reference this action and all third-party actions by full commit SHA. The example pins
checkout v6.0.2 and setup-node v6.4.0 by SHA; `action.yml` pins upload-artifact v7.0.1
by SHA. The v7 artifact client targets GitHub.com and requires a runner version that
supports its Node 24 action runtime. GitHub Enterprise Server users should select and
audit a server-supported upload-artifact major before adopting this metadata.

Never use `uses: ./` from the candidate checkout: that lets the pull request replace
the action implementation being trusted as the gate.

Do not publish only `action-dist/index.js` and its chunks. The distribution is an
indivisible directory and must also contain non-empty `libpg-query.wasm` and
`cytoscape.min.js`, plus `LICENSE`, `THIRD_PARTY_NOTICES.md`,
`THIRD_PARTY_LICENSES.txt`, `dependency-license-inventory.json`, and the exact asset
license texts under `licenses/`. Without the browser asset, analysis reaches
offline-graph rendering and then fails with a module-resolution error on a clean hosted
runner; omitting the legal files creates an incomplete distribution even when execution
succeeds.

## Inputs

The checkout paths default to `.api-intel-ci-workspaces/baseline` and
`.api-intel-ci-workspaces/candidate`. The trusted configuration defaults to
`.api-intel-ci-workspaces/baseline/api-intel.config.json`. Other defaults are:

| Input                                                    | Default                 | Contract                               |
| -------------------------------------------------------- | ----------------------- | -------------------------------------- |
| `baseline-revision` / `candidate-revision`               | required                | exact 40-64 character Git object IDs   |
| `baseline-package-manager` / `candidate-package-manager` | `pnpm`                  | `pnpm` or `npm` only                   |
| `*-package-manager-version`                              | `11.19.0`               | exact installed version                |
| `*-lockfile`                                             | `pnpm-lock.yaml`        | relative to that checkout              |
| `output-directory`                                       | `.api-intel-ci-results` | beneath the workspace                  |
| `max-annotations`                                        | `50`                    | integer from 1 through 50              |
| `upload-artifact`                                        | `true`                  | upload before outcome enforcement      |
| `artifact-name`                                          | `api-intel-ci`          | caller-controlled trusted display name |
| `retention-days`                                         | `7`                     | subject to repository policy           |

For npm repositories, set both package-manager inputs to `npm`, provide exact npm
versions, and set both lockfiles to `package-lock.json`. Mixed managers are supported
when explicitly declared.

## Output and failure behavior

The action writes GitHub outputs `outcome`, `process-exit-code`, `evaluation-id`,
`artifact-path`, `annotations-published`, and `annotations-omitted`. Evaluation
failures are recorded first so the upload step can retain evidence; a final composite
step exits with the stable code:

| Outcome                 | Exit |
| ----------------------- | ---: |
| `success`               |    0 |
| `policy_violation`      |    8 |
| `analysis_failure`      |    6 |
| `invalid_input`         |   10 |
| `incompatible_baseline` |   11 |
| `canceled`              |  130 |

At most 50 annotations are emitted. Blocking failures are ordered before warnings and
notices. Only safe candidate-relative paths receive file coordinates; baseline-only
or unsafe paths become job-level annotations. Workflow-command text is control-
escaped, and the Markdown summary is normalized, escaped, and capped at 64 KiB.

Every successful evaluation directory is named by its content-derived evaluation ID
and contains:

```text
api-intel-graph.html
ci-evaluation.json
ci-evaluation.md
ci-scan-recipe.json
diff.json
github-annotations.jsonl
github-summary.md
impact.json
manifest.json
policy-results.json
```

`manifest.json` records the byte length and SHA-256 content hash of every other file.
The offline graph remains self-contained. The action does not claim runtime behavior,
deployment, broker delivery, remote consumer execution, or cross-service blast radius.
P3.1 evaluates one repository pair. The separate P4.2 library can now calculate
qualified `distributed_conditional` system impact when a caller supplies exact
multi-service before/after artifacts and topology, but this action does not acquire or
publish that system-impact document automatically.

The maintained reference workflow and test matrix target GitHub-hosted Ubuntu 24.04.
A real pull-request run against `orders-worker-example` on Ubuntu 24.04, Node
22.14.0, and pnpm 11.19.0 has validated the job summary, bounded annotations, artifact
upload, and offline-graph generation using action commit
`f5e60a39231f11cc28cbb75c3772032cb38880d5`. Other runner operating systems have not
passed this adapter gate and are not currently claimed as supported. The validation
record and original packaging failure are retained in
[Phase P3.1 hosted validation](benchmarks/phase-p3-1-github-action.md).
