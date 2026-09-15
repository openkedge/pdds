# Frozen formal object model

Schemas live in `src/cctbench/schema/`. Unknown fields are rejected. The CLI rejects duplicate JSON keys, invalid Unicode, non-finite numbers and integers outside the supported JCS interoperable range. Fixture format `2.0.0`, protocol `1.0.0` and policy `v2.0.0` are distinct.

## Cryptographic objects

| Object | Committed fields |
| --- | --- |
| Proposal | identity_id, epoch, predecessor_commitment, ordered mutation_manifest, authority_bundle, provenance_manifest |
| Validation | check_id, evaluator, evaluator_version, policy_version, proposal_digest, status, timestamp, signature |
| Finalized core | proposal, validation_records |
| Receipt | receipt_id, kernel_id, identity_id, epoch, parent_digest, successor_digest, witness_core_digest, commit_timestamp, kernel_signature |
| Envelope | witness_version, witness_core, commit_receipt |

For type T, version v and object O, the preimage is JCS `["PCI-CCT-T-v", O]`; the digest is SHA-256 of those bytes, written `sha256:<hex>`. Required domains are STATE, PROPOSAL, WITNESS-CORE, AUTHORITY, ATTESTATION and COMMIT-RECEIPT. Evidence, event, tombstone, reference-history and experiment artifacts use distinct additional tags.

Schema-declared set arrays sort lexicographically by canonical member bytes: proposal signers/dependencies/citations/temporal references, core validation records, and state governance scopes/rule signer sets. Mutations, chronicles, belief histories, memories and arbitrary application-data arrays retain order. Duplicate principals, evaluator votes, dependency IDs, mutation IDs and event IDs are rejected by the applicable condition or application. Derived state display digests are excluded from state hashing.

Authority preimages are the **flat proposal without authority_bundle**, augmented with the signer's principal, role and scope. Evaluators sign their record without signature; kernels sign their receipt without kernel_signature. Ed25519 signs the raw 32-byte tagged digest; signatures are `ed25519:<hex>`.

The sequence is authority signing, finalized proposal digest, evaluator records binding d_prop, finalized core including those records, and receipt signing over d_core and state bindings. Evaluators do not bind the finalized core, avoiding circularity. Proposal dependencies resolve pre-existing JSON evidence; they do not reference this transition's future validation, core or receipt.

## Trust and attestations

VerificationContext is a separate trusted input: expected identity/epoch/protocol, public keys and historical status, allowed kernels, authoritative head evidence, resolver snapshots, signed external reference history, and validation clock. Deployments must authenticate these inputs independently. A receipt establishes its issuer and bindings under that context, not honest storage or truthful external evidence.

The optional `head_evidence_by_epoch` archive selects the authoritative snapshot for the transition epoch.
An explicitly indexed archive entry must match its identity/epoch binding. Without an archive entry,
`head_evidence` is applicable only to the proposal's identity and epoch: a later current head does not
invalidate a historical transition, and absent historical evidence yields UNKNOWN. Within an applicable
record, `exclusive: null` means unresolved competing tips; `false` is affirmative non-exclusivity.
Exact parent, proposal and successor bindings are checked independently, including when exclusivity
is unresolved: a present binding contradiction remains FAIL. Disabling head enforcement is vacuous PASS.

Missing receipts, unresolved heads, absent keys/historical status, required missing provenance and unreachable evidence produce UNKNOWN. Contradictory bindings, invalid signatures, unauthorized principals and corrupt resolved evidence produce FAIL. Known failures dominate missing information. Later revocation alone does not invalidate signatures authorized at their signing epoch; known compromise or revocation at that epoch does.

Empty signature or public-key material is also missing evidence. Nonempty malformed or cryptographically
incorrect material remains FAIL. Editing a signed core to omit a record can additionally contradict an
existing receipt; that binding failure is distinct from an honestly committed core missing required evidence.

Attestations bind the proposal and policy version, use authorized evaluator/version credentials, carry valid signatures, and fall within the policy freshness window relative to the trusted validation clock. The default maximum age is 3,600 seconds. Missing clock evidence is unresolved. Quorums count unique authenticated evaluators. Opposing quorums, insufficient votes or unresolved credential evidence yield UNKNOWN. The conflict generator supplies two PASS votes and two FAIL votes under quorum two.

## Native structured predicates

- Historical preservation retains old identifiers, commitments and order. Corrections append annotations. Authorized tombstones preserve the original commitment, timestamp and epoch and carry a dedicated identity/epoch/event/timestamp/reason signature. New events must match resolvable acquisition evidence.
- Temporal continuity uses the nondecreasing maximum historical event time, including tombstones; unchanged history and exact state copies are allowed. Acquisition claims cannot predate authenticated source times. Epochs are not wall-clock timestamps.
- New and changed belief records, including metadata-only revisions, preserve establishment epoch, developmental history and prior snapshots where applicable. Cited evidence must bind the proposal identity/epoch and contain an exact proposition/value/confidence support tuple. Missing support is UNKNOWN; contradictory support is FAIL. This is a structured revision predicate, not a natural-language theorem prover.
- Every changed relationship cites positive scoped session records. Unique append-only interaction identifiers determine the interaction count, preventing an invented count from seeding later trust elevation. Trust elevations also require enough predecessor interactions; newly asserted interactions cannot justify their own elevation. Initial state and its genesis interaction records are trusted inputs.
- Non-amendable normative rules must remain intact; class-level authority cannot authorize a prohibited core change.
- Provenance binds declared dependencies and derives mandatory justification references from operation types: knowledge insertion/backdating, event append, belief revision, correction, trust update, summary insertion, restore, and rebind. Missing declarations/resolution and contradictory resolved digests remain distinct.

Application is independent of admissibility: declared adversarial mutations may produce a successor that later invariants reject. Undeclared changes fail application equality. Invalid targets, duplicate operations and invalid preconditions fail application. Expired-context pruning requires expiration by predecessor time. CLAIM_SUCCESSION permits exact copied-state transitions whose authority is checked independently.

The paper's seven components map to chronicle; working memory; knowledge; beliefs; relationships; normative rules plus governance; and runtime configuration plus self-model. Epoch and timestamp are profile metadata. Upgrade/recovery/migration cases change structured runtime descriptors and verify authorization/bindings; they do not execute real model migrations or measure behavioral equivalence across runtimes.

The diagnostic verifier reports 13 conditions across five stages, including independent checks after FAIL. The eight invariant groups, application and externally required attestation resolution are separately ablatable. Disabled conditions are explicitly marked; their PASS placeholders do not claim execution.

This implementation accepts an already authenticated historical policy as a trusted input. It does not implement the manuscript's `ResolvePolicy` stage or establish a policy digest commitment in predecessor governance. Its implementation conformance claims cover post-resolution checks only.

A belief revision that preserves prior distinctions but lacks required justification evidence is UNKNOWN.
An erased or rewritten prior belief is FAIL even if justification is also unavailable, including when the
missing evidence and affirmative violation occur in different beliefs or dictionary iteration orders.
