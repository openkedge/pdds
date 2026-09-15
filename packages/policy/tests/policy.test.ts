import { describe, expect, it } from "vitest";
import type { ActionProposal, ControllerVisibleState, DependencyGraphSnapshot } from "@cac/schemas";
import {
  checkStaticCompliance,
  computeRisk,
  MemoryAuthorizer,
  postgresFailoverPolicyProfile,
  resolveObligations,
} from "../src/index.js";

describe("PostgreSQL Policy Resolver", () => {
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

  const dependencySnapshot: DependencyGraphSnapshot = {
    epoch: "dep-v1",
    edges: {
      "prod-cluster-a": ["auth-service", "billing-service"],
    },
  };

  it("passes static compliance for valid proposal and topology", () => {
    const result = checkStaticCompliance(proposal, state, postgresFailoverPolicyProfile);
    expect(result.compliant).toBe(true);
  });

  it("rejects static compliance when candidate standby is not in active nodes", () => {
    const badProposal = {
      ...proposal,
      params: { ...proposal.params, candidateStandby: "ghost-node-99" },
    };
    const result = checkStaticCompliance(badProposal, state, postgresFailoverPolicyProfile);
    expect(result.compliant).toBe(false);
    expect(result.reason).toContain("not in active cluster nodes");
  });

  it("computes risk vector deterministically", () => {
    const risk = computeRisk(proposal, state, dependencySnapshot);
    expect(risk.consequenceSeverity).toBe("HIGH");
    expect(risk.blastRadius).toBe("CLUSTER");
    expect(risk.irreversibility).toBe("COMPENSATABLE");
    expect(risk.epistemicUncertainty).toBe("LOW");
  });

  it("resolves the standard 3 obligations when within auto-authority threshold", () => {
    const risk = computeRisk(proposal, state, dependencySnapshot);
    const obligations = resolveObligations(risk, proposal, state, postgresFailoverPolicyProfile);
    expect(obligations).toHaveLength(3);
    expect(obligations.map((o) => o.id)).toEqual([
      "omega-1-replication-lag",
      "omega-2-standby-health",
      "omega-3-rollback-artifact",
    ]);
  });

  it("separates admission authorization snapshot from live authorizations", () => {
    const authorizer = new MemoryAuthorizer([
      {
        principal: "agent:sre-01",
        action: "FailoverDatabase",
        scope: ["postgres/prod-cluster-a"],
      },
    ]);

    const snapshot = authorizer.createSnapshot();
    expect(snapshot.isAuthorized("agent:sre-01", "FailoverDatabase", ["postgres/prod-cluster-a"])).toBe(true);

    // Revoke live
    authorizer.revoke("agent:sre-01");
    // Live check is now false
    expect(authorizer.isAuthorizedLive("agent:sre-01", "FailoverDatabase", ["postgres/prod-cluster-a"])).toBe(false);
    // Pinned admission snapshot is still true
    expect(snapshot.isAuthorized("agent:sre-01", "FailoverDatabase", ["postgres/prod-cluster-a"])).toBe(true);
  });
});
