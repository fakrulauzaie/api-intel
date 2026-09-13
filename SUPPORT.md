# Support Policy

## Support boundary

api-intel is initially a single-maintainer, local-first alpha project. Support is best
effort with no guaranteed response or resolution time. The maintainer may prioritize
correctness, security, evidence integrity, and reproducible regressions over feature
requests or broad framework coverage.

No public release exists yet. After the first alpha, support applies to the latest
published prerelease unless release notes explicitly say otherwise. There are no
routine backports for older alpha builds.

## Where a report belongs

- Reproducible engine or CLI failure: bug report.
- Supported pattern inferred incorrectly, missed, or stopped unexpectedly: analysis-
  accuracy report.
- Request to recognize a new NestJS, ORM, client, or transport version/pattern:
  framework-support proposal.
- Product or workflow capability: feature proposal.
- Suspected vulnerability: the private route in [SECURITY.md](SECURITY.md), never a
  public issue.
- Conduct incident: the private route in
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), never a public issue.

Blank issues are disabled. Public templates become active only after the release gates
enable issue intake.

## Minimum useful evidence

Include the api-intel version, analysis schema version, Node version, generic platform
and architecture, result state, diagnostic code counts, and the smallest synthetic
reproduction. State what was expected, what was observed, and the exact documented
pattern or proof boundary involved.

Start from the concise
[source-free reproduction workflow](docs/minimal-reproduction.md) and its strict
[diagnostic manifest](docs/support-diagnostic-manifest.md). Do not attach
`analysis.json`, `run.json`, an offline graph, CI artifacts, topology files, source
snippets, screenshots of private code, repository URLs, or logs containing paths.
Additional evidence may be requested, but you remain responsible for authorization and
review before sharing it.

## What support does not promise

- analysis of a private repository sent to the maintainer;
- guaranteed support for an unverified version or operating system;
- proof of runtime execution, delivery, data values, or complete blast radius;
- legal, compliance, audit, security-certification, or incident-response advice;
- custom consulting, migration delivery, or a feature deadline; or
- confidentiality for information placed in a public issue.

See [Compatibility and Version Support](docs/compatibility-and-support.md) for the
meaning of supported, verified, unverified, and unsupported.
