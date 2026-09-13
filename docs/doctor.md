# Doctor and Capability Preflight

`api-intel doctor [repository]` performs a deterministic, static preflight before a
scan. The repository argument defaults to the current directory. It does not install
packages, access the network, execute target modules, connect to infrastructure, or
write analysis artifacts.

```text
api-intel doctor [repository]
  [--config <path> | --no-config] [--tsconfig <path>]
  [--output <directory>] [--format text|json] [--probe-output]
```

The command inventories the same safe TypeScript inputs as `scan`, constructs the same
no-emit TypeScript program, and uses TypeScript-resolved import declarations to
recognize frameworks. A package name in `package.json` or an installed but unused
package is not framework evidence. It also validates project configuration, reports
the effective analysis bounds, checks the declared Node.js range and packaged runtime
assets, and describes which extractors are enabled and which framework families were
not observed.

## Results and stable checks

Every check has a stable code, a `pass`, `warning`, or `failure` status, a bounded
summary, optional remediation, and source-free facts. The overall result is the worst
check status. Warnings retain exit code `0`; failures use the existing analysis failure
exit code `6`. `--format json` emits doctor document schema `1.0.0` and is suitable for
an issue only after normal human review.

Common failures include:

- `DOCTOR_REPOSITORY_UNAVAILABLE` or `DOCTOR_REPOSITORY_NO_TYPESCRIPT`;
- `DOCTOR_TYPESCRIPT_PROGRAM_FAILED` for missing, invalid, out-of-root, or unsupported
  project-reference tsconfig inputs;
- `DOCTOR_TYPESCRIPT_IMPORTS_UNRESOLVED` for missing target declarations;
- `DOCTOR_CONFIGURATION_INVALID` for a malformed or schema-invalid configuration;
- `DOCTOR_NODE_RUNTIME_UNSUPPORTED`; and
- `DOCTOR_RUNTIME_ASSETS_MISSING`.

Exact package-version evidence is intentionally narrow. A resolved version outside
the retained compatibility corpus produces `DOCTOR_FRAMEWORK_VERSIONS_UNVERIFIED`,
not a claim that the version is incompatible. Framework syntax support remains
separate from package-version compatibility.

## Output-path honesty boundary

By default, `doctor` only inspects path metadata and the nearest existing ancestor.
`DOCTOR_OUTPUT_METADATA_ONLY` explicitly says that no future write has been proven.
Use `--probe-output` only when an actual permission check is needed. That explicit mode
creates one exclusive temporary file in the resolved output directory, flushes and
deletes it, and removes only directories that the probe itself created. Cleanup
failure is a blocking `DOCTOR_OUTPUT_PROBE_CLEANUP_FAILED` result.

The output always names the target as `<repository>`, uses repository-relative paths
where safe, replaces external paths with `<external-path>`, and never includes
environment values or credentials. It remains a low-data diagnostic, not an automatic
proof that every future scan or report will succeed.
