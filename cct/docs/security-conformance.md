# Formal security and conformance properties

Run the local security suite and generate its observed regression table:

```sh
make security-test
```

`make ci` executes the complete test suite, generates `docs/soundness-regression.md`, and writes
`test-results/junit.xml`. The GitHub Actions workflow runs this command on push, pull request and manual
dispatch, includes the Markdown table in the job summary, and uploads both reports even after a test
failure. The workflow needs no model credentials or external services. Actions are pinned to resolved
commits of the official [checkout](https://github.com/actions/checkout),
[setup-python](https://github.com/actions/setup-python) and
[upload-artifact](https://github.com/actions/upload-artifact) repositories.

Hypothesis uses 32 examples per property/parameter case in the deterministic `security-ci` profile.
Deadline checks are disabled because these properties measure correctness rather than performance.
The randomized profile retains minimized examples in Hypothesis's local database:

```sh
CCT_HYPOTHESIS_PROFILE=security-fuzz make security-test
# Replay a supplied seed or a minimized example using Hypothesis's reported instructions.
.venv/bin/python -m pytest tests/security --hypothesis-seed=20260904
```

The `security-fuzz` profile allows 250 examples per case. A property example can execute several verifier
calls; neither test counts nor generated example counts represent independent real-world transitions.

## Coverage and isolation

| Requirement | Executable coverage |
| --- | --- |
| Signed-field binding | All 18 requested proposal, authority, evaluator, state, core and receipt mutations, plus protocol-version replay |
| Identity and epoch isolation | Authority, attestation, core and receipt reuse; identical state bytes and deliberately shared signing keys remove easy identity cues |
| Proposal/attestation binding | Mutated Delta or E with fresh authority/receipt but untouched old attestations; the attestation checker itself must fail |
| Core/receipt binding | Add/remove/modify validation members underneath an untouched receipt; authenticate the old receipt independently |
| Missing/corrupt evidence | Paired UNKNOWN/FAIL tests for all five evidence classes, empty signatures/keys, missing bundles/manifests, and every ordered pair of distinct missing/contradictory classes |
| Canonical head | Disabled, valid, unavailable, competing, stale, contradictory lock, current-versus-historical epoch, and misbound archive cases |
| Proposition 2 | Sufficient class authority and authentic lineage cannot permit deletion of a non-amendable core rule |
| I7 versus I9 | Copied state, authentic receipt, valid application and unauthorized signer; lineage-only accepts while CCT rejects; no-witness clone remains INDETERMINATE |
| Historical preservation | Append, correction and authentic tombstone controls; deleted, rewritten, fabricated, malformed-tombstone and reordered history attacks |
| Belief evidence | Missing justification is UNKNOWN; lost developmental history is FAIL, independent of other missing justifications or belief iteration order |
| Temporal preservation | Acquisition chronology, backdating, unchanged event history, retained tombstone maximum and decreasing historical maximum |
| Canonicalization | Recursive JSON key permutations, UTF-16 key ordering, numeric equivalence, exact Unicode preservation, domain separation, ordered mutations and schema-specific set arrays |

The tests construct a VALID signed control before each attack. No security property takes its expected
verdict from a generator family label. Fresh outer signatures are sometimes deliberately issued to bind
the attacked object, isolating the specific inner predicate under test. Helpers name each reissued layer;
they never repair the target of a replay test. Ed25519 verification runs for real, with deterministic public
test keys. No external model or simulated semantic evaluator is needed.

An authentic signed negative attestation quorum still yields FAIL. An unsolicited signed PASS attestation
cannot override an active native historical predicate. Semantic attack tests retain PASS lineage and
authority so generic cryptographic rejection cannot masquerade as semantic checking.

## Missing information versus contradiction

The report collector requires every observed INVALID verdict to contain at least one actual FAIL.
Every INDETERMINATE verdict must contain UNKNOWN and no FAIL. Missing-only cases explicitly assert
that no unrelated predicate fails. The Cartesian missing/corrupt tests check both condition results and
FAIL dominance, not only the aggregate verdict.

Missing external data and a broken commitment are different. Removing a required validation record and
then honestly committing the remaining core yields UNKNOWN for missing quorum evidence. Removing it
from beneath an existing receipt also changes d_core, so that receipt's binding fails. A tombstone that
discards an already-known original commitment similarly violates preservation; it is not just an offline
evidence source. Malformed JSON outside the documented wire profile is rejected at parsing, not assigned
an invented verifier verdict.

## Ordered versus set-valued arrays

The request's receipt-reordering clause is interpreted according to the manuscript's explicit set rule:
reordering the same validation members **must preserve** d_core and the existing receipt. Adding,
removing or modifying members changes the core. Signer and evaluator collections sort lexicographically
by canonical member bytes. Mutation arrays remain ordered, and arrays in arbitrary application data do
not inherit set semantics just because they are named `signers` or `validation_records`.

JCS fuzzing uses finite binary64 values and the documented interoperable integer range; invalid Unicode,
non-finite numbers and duplicate keys also have explicit parser regressions in the complete suite.

## Executed regression table

`docs/soundness-regression.md` is generated by pytest from observed condition/checker reports, alongside
the expected property and actual final verdict. It is not a hand-populated expectation table. The report
is marked FAILED / INCOMPLETE if the run fails, and requesting a report with no recorded security cases
cannot succeed. Low-level JCS algebraic properties without a verifier call remain ordinary tests and do
not receive invented CCT verdicts in the table. CI generates the report anew rather than trusting a
previous checked-in PASS table.

The table records a digest of the source/test file hashes, dependency freeze, Makefile and workflow.
CI clears the checked-in report before installation/execution so an infrastructure failure cannot upload
an old PASS table as the current result. The benchmark source manifest also includes nested security tests.
