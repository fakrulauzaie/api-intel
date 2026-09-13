# Fixture and Example Provenance

Status: audited for Phase O4.3; owner boundary recorded on 2026-09-10

This register distinguishes project-authored fixtures from externally derived
evidence. It is an ownership and redistribution input, not legal advice.

| Material                                              | Provenance                                                                                                      | Redistribution treatment                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `example-nestjs-app/`                                 | Project-authored synthetic NestJS/TypeORM application created for this analyzer                                 | Distributed under the repository Apache-2.0 license                                                                                                          |
| `test/fixtures/**/*.ts.txt` and expectation manifests | Project-authored synthetic positive, negative, ambiguous, and unsupported cases                                 | Distributed under the repository Apache-2.0 license; framework names and public API shapes identify compatibility targets rather than copied implementations |
| `test/helpers/` declaration stubs                     | Project-authored minimal type surfaces used only by the TypeScript checker                                      | Distributed under the repository Apache-2.0 license; they are not upstream framework declaration files                                                       |
| `test/fixtures/system-stitching/`                     | Project-authored synthetic orders API/worker topology with positive, missing, collision, and ambiguity cases    | Sanitized in Phase O1.2; retains semantic contracts without organization-derived repository, queue, message, or table identifiers                            |
| `docs/examples/synthetic-legacy-system/`              | Project-authored walkthrough and concise expected projection of the frozen system-stitching corpus              | Distributed under Apache-2.0; an executable documentation test binds the duplicated expectation to the canonical fixture manifest                            |
| `test/fixtures/resources/critical-section-wrappers/`  | Project-authored synthetic order/workflow lock-wrapper cases                                                    | Sanitized in Phase O1.2; retains direct, forwarded, cyclic, transformed, and unsupported callback-flow contracts                                             |
| `docs/examples/current/`                              | Generated from the project-authored `example-nestjs-app` fixture                                                | Distributed under the repository Apache-2.0 license                                                                                                          |
| `docs/examples/official-nestjs-typeorm/`              | Sanitized analyzer output from NestJS `sample/05-sql-typeorm` at `841df8792fbedd1fbba12c9fe999aee307a155c7`     | Retain NestJS MIT attribution in `THIRD_PARTY_NOTICES.md`; no upstream source checkout is committed                                                          |
| `.demo/reference-nest/` and `.demo/official-nest-*`   | Reproducibly downloaded/generated local validation material                                                     | Ignored and excluded from source/npm/action/container distributions                                                                                          |
| `docs/assets/evidence-path.svg`                       | Project-authored vector illustration based only on the public synthetic Notes fixture's supported semantic path | Distributed under Apache-2.0; it is an explanatory illustration, not private output, a browser screenshot, or named-browser validation evidence              |

The distributed BullMQ and Nest microservice fixture manifests link to upstream source
and documentation to pin the public API behavior that informed the cases. Those links
are compatibility evidence; the fixture bodies are synthetic and intentionally do not
copy upstream implementations.

Private use of an organization's systems as analyzer targets was permitted for
development testing only. That permission does not authorize public redistribution of
their source, data, identifiers, topology, business behavior, screenshots, generated
reports, or other system details. The project owner attests that the distributable
fixtures listed above are independently authored synthetic material. Renaming an
externally derived example is not sufficient; any such material must be removed or
replaced with a generalized fixture written from the analyzer's public semantic
contract.

## Change rule

New fixtures, copied snippets, screenshots, generated outputs from external
repositories, or borrowed samples must update this register. Material with unknown
ownership or incompatible terms blocks public distribution until replaced or cleared.

Historical benchmark documents retain dated counts and outcomes but use sanitized
synthetic aliases for organization-derived repositories, source symbols, broker
destinations, and resources. They are not a distributable copy of either target
repository and cannot be used to reconstruct its source.
