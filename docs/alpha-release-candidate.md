# Audited Alpha Release Candidate

Historical status: O5.1 completed before `0.1.0-alpha.1` was published. For current
consumer evidence, see [Published Release Verification](published-release-verification.md).

Phase O5.1 creates a separate, content-addressed candidate beneath
`.tmp/public-alpha-candidate/`. It does not change repository visibility, initialize
public history, tag source, publish a package or image, or activate a community
channel.

## Freeze workflow

Prepare and verify the private source first:

```powershell
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run schema:check
pnpm run compatibility:check
pnpm run test
pnpm run audit:public
pnpm run audit:licenses
pnpm run audit:dependencies
pnpm run pack:contents:check
pnpm run pack:clean-room:check
pnpm run artifacts:check
pnpm run release:integrity
```

Then stage and recheck the candidate:

```powershell
pnpm run release:alpha:stage
pnpm run release:alpha:check
```

The exporter inventories tracked and non-ignored untracked source, rejects every
non-allowlisted root and forbidden generated/dependency/history segment, copies only
regular files, omits `.git`, and removes only the staged `package.json` `private`
property. The private workspace retains `"private": true`.

The retained manifest binds the private Git HEAD as ancestry evidence plus a hash of
every current private source file. Because accumulated implementation work may not be
a clean Git commit, the content hash—not HEAD alone—is the exact source identity. The
staged public tree has a separate per-file ledger and content fingerprint.

Two independent `npm pack` operations must produce identical bytes. The exact staged
archive is installed into a disposable consumer with lifecycle scripts disabled; its
public manifest, CLI version/help, and both schema exports are checked. A separate
checksum ledger covers every staged source and release-artifact byte.

## Honest gate result

O5.1 passed the candidate-level OT0, OD0, OR0, and OX0 checks while retaining external
prerequisites as explicit blockers. O5.2 then activated the sanitized public
repository and private reporting channels. At this candidate stage, the artifact
could not prove its own GitHub/GitLab hosted run, an unpublished OCI image digest/SBOM,
or a named browser matrix. O5.3 later verified the published npm package and GitHub
Action; GitLab/OCI and named-browser claims remain withheld.

The owner separately authorized the exact Phase O5.2 repository and package sequence
on 2026-09-13. Never copy the private `.git` directory or infer redistribution
permission from private target-testing permission.
