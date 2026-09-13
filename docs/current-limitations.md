# Current Limitations

Status: normative alpha limitation ledger  
Applies to: current `0.1.0-alpha.1` source tree and Analysis v8

This is the short list a user should read before interpreting an absent edge or
terminal. The complete syntax matrix and diagnostic behavior remain in
[Supported Static-Analysis Patterns](supported-patterns.md).
An empty result never proves the absence of behavior outside the documented static
patterns.

| Boundary                 | Current behavior                                                                                  | Do not infer                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Static source only       | Reads TypeScript and resolved declarations without executing the target                           | Runtime execution, frequency, values, timing, or production reachability                        |
| Supported syntax         | Recognizes only documented checker-proven and bounded AST forms                                   | That an unreported framework/client pattern has no effect                                       |
| Type information         | Needs installed target dependencies and a usable TypeScript project                               | That a package name or declaration stub proves a real compatible version                        |
| Dynamic values           | Retains symbolic structure or a diagnostic when a target cannot be resolved                       | A concrete URL, event, queue, job, broker pattern, key, table, guard, or callback target        |
| Call graph               | Bounded to configured depth/fan-out and supported receiver/callback forms                         | Complete whole-program reachability or dead code                                                |
| Database effects         | Reports potential table/resource operations reached by supported static paths                     | Transaction success, predicates selected at runtime, affected rows, or stored values            |
| Async local events       | Links exact/configured wildcard candidates and keeps fan-out explicit                             | Listener order, successful execution, or absence of dynamically registered listeners            |
| Queues and microservices | Open-world producers and local handlers are delivery candidates; topology can narrow broker realm | Deployment, routing, delivery, acknowledgement, retry outcome, or remote execution              |
| HTTP                     | Retains static/template/symbolic target evidence for supported clients                            | DNS, connectivity, response status, authentication, or downstream implementation                |
| Guards and policy        | Reports declared/effective static guard facts and exact rule outcomes                             | Runtime authorization success, security certification, or compliance                            |
| Artifacts                | Redacts selected payload-like values but retains architecture evidence                            | That a generated bundle is safe to publish without review                                       |
| Platform compatibility   | Claims only the exact environments in the current support table                                   | Support for an adjacent Node, framework, operating-system, runner, browser, or MCP-host version |

`completed_with_gaps`, `unknown`, `ambiguous`, `target_only_candidate`,
`external_or_unobserved`, and `distributed_conditional` are useful results. They mark
where proof stopped; they must not be normalized into success/failure or hidden from a
review.

Raw SQL is opt-in and currently supports only the pinned PostgreSQL 18 parser path.
The package is CLI-first: internal JavaScript modules and deep imports are not a public
API. Remote MCP, hosted source analysis, SaaS, telemetry, and IDE plugins are deferred.

Report an unexpectedly short path using the
[source-free reproduction workflow](minimal-reproduction.md), including the exact
diagnostic codes and the smallest independently authored synthetic pattern.
