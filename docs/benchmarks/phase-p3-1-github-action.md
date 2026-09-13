# Phase P3.1 GitHub Action Hosted Validation

Date: 2026-09-07  
Target: `orders-worker-example`
Runner: GitHub-hosted `ubuntu-24.04`  
Runtime: Node 22.14.0 and pnpm 11.19.0

## Scope and result

The target repository used the ordinary `pull_request` reference topology: distinct
exact-SHA baseline and candidate checkouts, persisted credentials disabled, read-only
contents permission, and trusted baseline configuration. The action itself was pinned
by full commit SHA.

The hosted rerun with action commit
`f5e60a39231f11cc28cbb75c3772032cb38880d5` passed the observable P3.1 publication
surface:

- GitHub Step Summary rendered;
- bounded pull-request file annotations were published;
- the canonical evaluation directory was uploaded as a downloadable artifact; and
- offline graph generation completed inside the clean hosted runner.

This was a manual hosted validation reported from the target repository. It validates
the documented GitHub runner path; it does not extend the support claim to other runner
operating systems or to the GitLab component.

## Packaging incident and resolution

The first hosted attempt used action commit
`e96886f2092efd61ab742f74dc78796cb2156fce` and failed during offline graph rendering:

```text
Cannot find module 'cytoscape/dist/cytoscape.min.js'
```

The ncc JavaScript bundle preserved a runtime browser-asset lookup, while a clean
Actions checkout had no independent dependency installation for the action itself.
Target repository dependencies could not and should not satisfy a trusted action
runtime dependency.

The corrected build copies the exact locked
`node_modules/cytoscape/dist/cytoscape.min.js` bytes into `action-dist/cytoscape.min.js`.
The renderer resolves this trusted colocated asset before its normal package fallback.
The same rule is applied to `gitlab-dist` so its OCI image is self-sufficient, although
GitLab-hosted validation was not part of this GitHub run and is now explicitly deferred.

Regression checks now require both distributions to contain a non-empty browser asset
whose bytes exactly match the pinned Cytoscape dependency. Distribution fingerprints
include that file, so omitting or changing it changes the P2.2 engine-distribution
identity.
