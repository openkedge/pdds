import { describe, expect, it } from "vitest";
import { FrozenClock } from "@cac/core";
import { verifyAuthenticity } from "@cac/evidence";
import {
  PostgresClusterModel,
  PostgresFailoverAdapter,
  PostgresTelemetryObserver,
} from "../src/index.js";

describe("PostgreSQL Adapter and Telemetry Observer", () => {
  const clock = new FrozenClock(10000);
  const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
  const observer = new PostgresTelemetryObserver(cluster, clock, {
    sourceIdentifier: "probe.postgres.prod-cluster-a",
    signingKeyOrSecret: "test-secret",
    signingMethod: "HMAC_SHA256",
  });
  const adapter = new PostgresFailoverAdapter(cluster);

  it("produces authentic replication telemetry receipts", async () => {
    const receipt = await observer.inspectReplication("replica-02");
    expect(receipt.evidenceClass).toBe("POSTGRES_TELEMETRY");
    expect(receipt.claim["replicationLagBytes"]).toBe(512);
    expect(verifyAuthenticity(receipt, { trustedSigners: new Set(), hmacSecret: "test-secret" })).toBe(true);
  });

  it("produces authentic standby health receipts", async () => {
    const receipt = await observer.inspectStandbyHealth("replica-02");
    expect(receipt.claim["isInRecovery"]).toBe(true);
    expect(receipt.claim["role"]).toBe("standby");
    expect(verifyAuthenticity(receipt, { trustedSigners: new Set(), hmacSecret: "test-secret" })).toBe(true);
  });

  it("produces authentic rollback attestation receipts", async () => {
    const receipt = await observer.verifyRollbackSnapshot();
    expect(receipt.evidenceClass).toBe("ROLLBACK_ATTESTATION");
    expect(receipt.claim["validRollbackSnapshot"]).toBe(true);
    expect(verifyAuthenticity(receipt, { trustedSigners: new Set(), hmacSecret: "test-secret" })).toBe(true);
  });

  it("exposes live controller-visible state for gateway guards", () => {
    const state = adapter.getLiveState("replica-02");
    expect(state.clusterId).toBe("prod-cluster-a");
    expect(state.candidateRole).toBe("standby");
    expect(state.activeNodes).toContain("replica-02");
  });

  it("executes failover mutation via adapter", async () => {
    const result = await adapter.execute("FailoverDatabase", {
      clusterId: "prod-cluster-a",
      candidateStandby: "replica-02",
    });

    expect(result.outcome).toBe("SUCCESS");
    expect(result.details?.["newPrimary"]).toBe("replica-02");

    // After failover, state shows replica-02 is now primary
    const nodeState = cluster.getNode("replica-02");
    expect(nodeState?.role).toBe("primary");
    expect(nodeState?.isInRecovery).toBe(false);
  });
});
