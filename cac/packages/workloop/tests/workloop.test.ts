import { describe, expect, it } from "vitest";
import type {
  ActionProposal,
  AssuranceObligation,
  ControllerVisibleState,
  EvaluationContext,
} from "@cac/schemas";
import { signEvidenceReceipt, isLocallyEligible, computeEligibilityDiagnostics } from "@cac/evidence";
import { discharge, generateRemediationContract, selectCanonicalWitness } from "../src/index.js";

describe("Deterministic Discharge Engine", () => {
  const proposal: ActionProposal = {
    intent: {
      goal: "restore-primary-availability",
      scope: ["postgres/prod-cluster-a"],
      constraints: ["no-data-loss", "single-primary"],
    },
    action: "FailoverDatabase",
    params: {
      clusterId: "prod-cluster-a",
      candidateStandby: "replica-02",
    },
    scope: ["postgres/prod-cluster-a"],
    principal: "agent:sre-01",
    observedStateVersion: "lsn:0/3000000",
    constraints: {
      maxDataLossBytes: 0,
    },
  };

  const state: ControllerVisibleState = {
    clusterId: "prod-cluster-a",
    observedVersion: "lsn:0/3000000",
    activeNodes: ["replica-01", "replica-02"],
    candidateRole: "standby",
    replicationEpoch: 42,
  };

  const obligation: AssuranceObligation = {
    id: "omega-1-replication-lag",
    kind: "OBSERVE",
    predicate: "replication_lag_bytes <= 1048576",
    target: "cluster.primary",
    scope: ["postgres/prod-cluster-a"],
    maxFreshnessMs: 2000,
    evidenceClasses: ["POSTGRES_TELEMETRY"],
    efdRequirement: null,
    setConstraints: null,
    enforcement: "REQUIRED",
    guardTemplates: [],
  };

  const evalContext: EvaluationContext = {
    policySnapshot: {
      policyId: "p1",
      epoch: "e1",
      targetAction: "FailoverDatabase",
      riskTier: "TIER_3",
      autoAuthorityThreshold: {
        consequenceSeverity: "HIGH",
        blastRadius: "CLUSTER",
        irreversibility: "COMPENSATABLE",
        epistemicUncertainty: "LOW",
        dependencyExposure: "TIER_1",
        adversePlausibility: "POSSIBLE",
      },
      staticInvariants: [],
      obligationRules: [],
    },
    evaluationTime: { epochMs: 12000, iso: new Date(12000).toISOString() },
    operationalBudget: {
      remainingTokens: 10000,
      remainingTurns: 5,
      deadlineEpochMs: 50000,
      costBudgetUsd: 1.0,
    },
    dependencySnapshot: { epoch: "d1", edges: {} },
    authorizationSnapshot: { isAuthorized: () => true },
  };

  const trustedRoots = { trustedSigners: new Set<string>(), hmacSecret: "secret" };

  it("returns UNKNOWN(MISSING) when no evidence is provided", () => {
    const res = discharge(obligation, [], state, evalContext, trustedRoots);
    expect(res.kind).toBe("UNKNOWN");
    if (res.kind === "UNKNOWN") {
      expect(res.reason).toEqual({ kind: "MISSING" });
    }
  });

  it("returns SATISFIED when valid fresh positive evidence is provided", () => {
    const receipt = signEvidenceReceipt(
      {
        id: "rec-lag-good",
        claim: { replicationLagBytes: 4096 },
        evidenceClass: "POSTGRES_TELEMETRY",
        source: "probe.postgres.prod-a",
        provenance: { tool: "pg_stat_replication", runId: "r1", parentReceiptIds: [] },
        scope: ["postgres/prod-cluster-a"],
        observedAt: { epochMs: 11500, iso: new Date(11500).toISOString() }, // age 500ms <= 2000ms
        stateVersion: "lsn:0/3000000",
        dependencies: [],
      },
      "secret",
      "HMAC_SHA256"
    );

    const res = discharge(obligation, [receipt], state, evalContext, trustedRoots);
    expect(res.kind).toBe("SATISFIED");
    if (res.kind === "SATISFIED") {
      expect(res.witness).toHaveLength(1);
      expect(res.witness[0]?.id).toBe("rec-lag-good");
    }
  });

  it("returns VIOLATED when affirmative counter-evidence is provided", () => {
    const badReceipt = signEvidenceReceipt(
      {
        id: "rec-lag-excessive",
        claim: { replicationLagBytes: 50000000 }, // 50MB >> 1MB
        evidenceClass: "POSTGRES_TELEMETRY",
        source: "probe.postgres.prod-a",
        provenance: { tool: "pg_stat_replication", runId: "r1", parentReceiptIds: [] },
        scope: ["postgres/prod-cluster-a"],
        observedAt: { epochMs: 11500, iso: new Date(11500).toISOString() },
        stateVersion: "lsn:0/3000000",
        dependencies: [],
      },
      "secret",
      "HMAC_SHA256"
    );

    const res = discharge(obligation, [badReceipt], state, evalContext, trustedRoots);
    expect(res.kind).toBe("VIOLATED");
    if (res.kind === "VIOLATED") {
      expect(res.witness).toHaveLength(1);
      expect(res.witness[0]?.id).toBe("rec-lag-excessive");
    }
  });

  it("returns UNKNOWN(STALE) when evidence is expired relative to pinned evaluationTime", () => {
    const staleReceipt = signEvidenceReceipt(
      {
        id: "rec-lag-stale",
        claim: { replicationLagBytes: 512 },
        evidenceClass: "POSTGRES_TELEMETRY",
        source: "probe.postgres.prod-a",
        provenance: { tool: "pg_stat_replication", runId: "r1", parentReceiptIds: [] },
        scope: ["postgres/prod-cluster-a"],
        observedAt: { epochMs: 9000, iso: new Date(9000).toISOString() }, // age 3000ms > 2000ms
        stateVersion: "lsn:0/3000000",
        dependencies: [],
      },
      "secret",
      "HMAC_SHA256"
    );

    const res = discharge(obligation, [staleReceipt], state, evalContext, trustedRoots);
    expect(res.kind).toBe("UNKNOWN");
    if (res.kind === "UNKNOWN") {
      expect(res.reason).toEqual({ kind: "STALE" });
    }
  });

  it("generates targeted remediation contract on UNKNOWN", () => {
    const remediation = generateRemediationContract(
      obligation,
      { kind: "MISSING" },
      proposal
    );
    expect(remediation.obligationId).toBe("omega-1-replication-lag");
    expect(remediation.reason).toEqual({ kind: "MISSING" });
    expect(remediation.remediation.tool).toBe("postgres.inspectReplication");
    expect(remediation.remediation.expectedEvidenceClass).toBe("POSTGRES_TELEMETRY");
  });
  function receipt(id: string, lag: number, source = id) {
    return signEvidenceReceipt({ id, claim: { replicationLagBytes: lag }, evidenceClass: "POSTGRES_TELEMETRY",
      source, provenance: { tool: "test", runId: id, parentReceiptIds: [] }, scope: obligation.scope,
      observedAt: evalContext.evaluationTime, stateVersion: state.observedVersion, dependencies: [] }, "secret", "HMAC_SHA256");
  }
  it("does not let a negative singleton bypass a quorum", () => {
    const quorum = { ...obligation, setConstraints: { minCardinality: 2 } };
    expect(discharge(quorum, [receipt("n", 50000000)], state, evalContext, trustedRoots).kind).toBe("UNKNOWN");
    expect(discharge(quorum, [receipt("n", 50000000), receipt("m", 50000000)], state, evalContext, trustedRoots).kind).toBe("VIOLATED");
  });
  it("finds a reconciling subset when the full positive pool disagrees", () => {
    const quorum = { ...obligation, setConstraints: { minCardinality: 2, requireReconciliation: true } };
    const pool = [receipt("a", 0), receipt("b", 10), receipt("c", 100000)];
    const result = discharge(quorum, pool, state, evalContext, trustedRoots);
    expect(result.kind).toBe("SATISFIED");
    if (result.kind === "SATISFIED") expect(result.witness.map(r => r.id)).toEqual(["a", "b"]);
    expect(discharge(quorum, pool.reverse(), state, evalContext, trustedRoots)).toEqual(result);
  });
  it("uses explicit policy preference, never source prefixes, to resolve valid polarities", () => {
    const pool = [receipt("p", 0, "probe.postgres.fake"), receipt("n", 50000000, "cache.real")];
    expect(discharge(obligation, pool, state, evalContext, trustedRoots)).toEqual({ kind: "UNKNOWN", reason: { kind: "CONFLICT" } });
    const policy = { ...obligation, sourcePriorities: { "cache.real": 2 } };
    expect(discharge(policy, pool, state, evalContext, trustedRoots).kind).toBe("VIOLATED");
  });
  it("deduplicates receipts and fails closed on search exhaustion", () => {
    const one = receipt("same", 0);
    expect(discharge({ ...obligation, setConstraints: { minCardinality: 2 } }, [one, one], state, evalContext, trustedRoots).kind).toBe("UNKNOWN");
    expect(discharge(obligation, Array.from({ length: 13 }, (_, i) => receipt(String(i), 0)), state, evalContext, trustedRoots))
      .toEqual({ kind: "UNKNOWN", reason: { kind: "SEARCH_LIMIT", limit: 12 } });
  });

  it("agrees with diagnostics at future and freshness boundaries", () => {
    for (const age of [-1, 0, 2000, 2001]) {
      const raw = receipt(`age-${age}`, 0);
      const { integrity: _integrity, ...body } = raw;
      const r = signEvidenceReceipt({ ...body, observedAt: { epochMs: 12000-age, iso: new Date(12000-age).toISOString() } }, "secret", "HMAC_SHA256");
      expect(isLocallyEligible(r, obligation, state, evalContext, trustedRoots)).toBe(age >= 0 && age <= 2000);
      expect(computeEligibilityDiagnostics([r], obligation, state, evalContext, trustedRoots).eligible.length).toBe(age >= 0 && age <= 2000 ? 1 : 0);
    }
  });

  it("ranks by computed structural cut, not nominal source count", () => {
    const larger = { receipts: [receipt("a", 0), receipt("b", 0), receipt("c", 0)], structuralCut: 1 };
    const smaller = { receipts: [receipt("d", 0), receipt("e", 0)], structuralCut: 2 };
    const rule = { ...obligation, efdRequirement: { profileId: "p", minimumStructuralCut: 1, disallowedFaults: [] } };
    expect(selectCanonicalWitness([larger, smaller], rule, evalContext.evaluationTime)).toBe(smaller);
    const singleton = { receipts: [receipt("f", 0)] };
    expect(selectCanonicalWitness([larger, singleton], obligation, evalContext.evaluationTime)).toBe(singleton);
  });

});
