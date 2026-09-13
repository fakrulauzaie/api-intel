# Security Policy

## Current release state

No public version has been released or declared supported. After the first alpha, only
the latest published prerelease will receive best-effort security fixes; older alpha
builds will not receive routine backports. The compatibility policy and release notes
will identify any exception explicitly.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue, pull request, discussion,
CI log, graph, or analysis artifact.

The private reporting path is GitHub Private Vulnerability Reporting for
[`fakrulauzaie/api-intel`](https://github.com/fakrulauzaie/api-intel). The channel is
active. Use **Security → Report a vulnerability** or open a
[private vulnerability report](https://github.com/fakrulauzaie/api-intel/security/advisories/new).
Do not send vulnerability details to the conduct-reporting address or through an
ordinary project channel.

Include only:

- the affected api-intel version and distribution surface;
- the vulnerability class and realistic impact;
- minimal reproduction steps using synthetic inputs where possible;
- whether public exploitation or disclosure is already known; and
- a proposed disclosure timeline, if relevant.

Do not attach a target repository, `analysis.json`, `run.json`, graph, credentials, or
customer data unless the maintainer requests a narrowly scoped artifact through the
private advisory and you have authority to share it.

## Response expectations

This is initially a single-maintainer project. The non-binding targets after the
private channel is activated are:

- acknowledgement within 7 calendar days;
- an initial severity and scope assessment within 14 calendar days; and
- an update at least every 30 calendar days while an accepted report remains open.

These are best-effort targets, not an SLA or a promise of a fix date. The maintainer
may request more evidence, reject reports outside the project's threat model, or
coordinate a release and disclosure date. There is no bug-bounty program.

## Security scope

Relevant reports include unintended target-code execution, unsafe artifact or path
handling, command injection, authorization bypass in a publishing adapter, secret
exposure caused by api-intel, dependency compromise, or a material contradiction of
the documented local/no-telemetry boundary.

Ordinary false positives, false negatives, unsupported framework patterns, expected
artifact sensitivity, and proof stopping at a documented boundary belong in the
appropriate issue template after public issue intake is enabled. See
[SUPPORT.md](SUPPORT.md) and the
[privacy and artifact-safety policy](docs/privacy-and-artifact-safety.md).
