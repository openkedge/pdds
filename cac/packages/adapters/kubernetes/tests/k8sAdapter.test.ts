import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { SystemClock } from "@cac/core";
import {
  KubernetesClusterModel,
  KubernetesTelemetryObserver,
  KubernetesMutationAdapter,
  k8sDrainNodePolicyProfile,
} from "../src/index.js";
import { CACController } from "@cac/workloop";
import { MemoryAuthorizer } from "@cac/policy";
import { MemoryCapabilityStore, authorizedDispatch } from "@cac/gateway";
import type { KubernetesActionProposal, EvaluationContext } from "@cac/schemas";

describe("Kubernetes Adapter Conformance & Complete Mediation", () => {
  let cluster: KubernetesClusterModel;
  let clock: SystemClock;
  let observer: KubernetesTelemetryObserver;
  let adapter: KubernetesMutationAdapter;
  let controllerKeys: { publicKey: string; privateKey: string };
  let capabilityStore: MemoryCapabilityStore;

  beforeEach(() => {
    cluster = new KubernetesClusterModel({ clusterName: "k8s-prod", enforceCompleteMediation: true });
    clock = new SystemClock();
    capabilityStore = new MemoryCapabilityStore();

    // Populate cluster resources
    cluster.addNode({
      metadata: { name: "node-worker-1", resourceVersion: "10" },
      spec: { unschedulable: false },
      status: {
        conditions: [{ type: "Ready", status: "True" }],
        capacity: { cpu: "8", memory: "32Gi" },
      },
    });

    cluster.addPod({
      metadata: { name: "api-pod-1", namespace: "default", labels: { app: "api" }, resourceVersion: "1" },
      spec: {
        nodeName: "node-worker-1",
        containers: [{ name: "api", image: "repo/api:v1" }],
      },
      status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
    });

    cluster.addPDB({
      metadata: { name: "api-pdb", namespace: "default", resourceVersion: "1" },
      spec: { minAvailable: 1, selector: { matchLabels: { app: "api" } } },
      status: { currentHealthy: 3, desiredHealthy: 1, disruptionsAllowed: 2, expectedPods: 3 },
    });

    const keyPair = generateKeyPairSync("ed25519");
    controllerKeys = {
      publicKey: keyPair.publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };

    observer = new KubernetesTelemetryObserver(cluster, clock, {
      sourceIdentifier: "cac.k8s.observer",
      signingKeyOrSecret: controllerKeys.privateKey,
      signingMethod: "ED25519",
      signerPublicKey: controllerKeys.publicKey,
    });

    adapter = new KubernetesMutationAdapter(cluster);
  });

  it("Complete Mediation Negative Test: Raw direct mutation without CAC token is rejected by Admission Webhook", () => {
    // Attempting raw update without dispatch token
    expect(() => {
      cluster.updateNode("node-worker-1", (n) => {
        n.spec.unschedulable = true;
      });
    }).toThrow(/Complete mediation violation: raw mutation rejected without valid CAC single-dispatch token/);

    // Node state remains unchanged
    expect(cluster.getNode("node-worker-1")?.spec.unschedulable).toBe(false);
  });

  it("Mode B Concurrency Rejection: Stale resourceVersion is rejected", async () => {
    const result = await adapter.execute("DrainNode", {
      nodeName: "node-worker-1",
      expectedResourceVersion: "9", // current is "10"
    });

    expect(result.outcome).toBe("FAILED");
    expect(result.error).toContain("Mode B conflict: live resourceVersion 10 != expected 9");
    expect(cluster.getNode("node-worker-1")?.spec.unschedulable).toBe(false);
  });

  it("Live Guard: DrainNode fails if PDB disruptionsAllowed <= 0", async () => {
    // Reduce PDB disruptionsAllowed to 0
    const pdb = cluster.getPDB("api-pdb")!;
    pdb.status.disruptionsAllowed = 0;

    const result = await adapter.execute("DrainNode", {
      nodeName: "node-worker-1",
      expectedResourceVersion: "10",
    });

    expect(result.outcome).toBe("FAILED");
    expect(result.error).toContain("Guard violation: PDB 'api-pdb' has disruptionsAllowed=0");
    expect(cluster.getNode("node-worker-1")?.spec.unschedulable).toBe(false);
  });

  it("End-to-End CAC Workflow for Kubernetes DrainNode", async () => {
    const proposal: KubernetesActionProposal = {
      intent: { goal: "Safely drain worker node for scheduled maintenance", scope: ["kubernetes/k8s-prod"], constraints: ["zero_downtime"] },
      action: "DrainNode",
      params: { nodeName: "node-worker-1", expectedResourceVersion: "10" },
      scope: ["kubernetes/k8s-prod"],
      principal: "agent.k8s.maintenance",
      observedStateVersion: "10",
      constraints: {},
    };

    // 1. Gather Telemetry via Observer
    const nodeReceipt = await observer.inspectNode("node-worker-1");
    const pdbReceipt = await observer.inspectPDB("api-pdb");

    // 2. Full CAC Admission Evaluation
    const controller = new CACController({
      controllerPrivateKeyPem: controllerKeys.privateKey,
      trustedRoots: {
        trustedSigners: new Set([controllerKeys.publicKey, "cac.k8s.observer"]),
        hmacSecret: "secret",
      },
    });

    const context: EvaluationContext = {
      policySnapshot: k8sDrainNodePolicyProfile,
      evaluationTime: clock.now(),
      operationalBudget: {
        remainingTokens: 10000,
        remainingTurns: 5,
        deadlineEpochMs: clock.now().epochMs + 60000,
        costBudgetUsd: 1.0,
      },
      dependencySnapshot: { epoch: "dep-v1", edges: {} },
      authorizationSnapshot: new MemoryAuthorizer([
        { principal: proposal.principal, action: proposal.action, scope: proposal.scope },
      ]),
    };

    const authorizer = new MemoryAuthorizer([
      { principal: proposal.principal, action: proposal.action, scope: proposal.scope },
    ]);

    const verdict = controller.evaluate(
      proposal,
      cluster.getControllerVisibleState(),
      [nodeReceipt, pdbReceipt],
      context
    );

    expect(verdict.kind).toBe("PERMIT");
    if (verdict.kind !== "PERMIT") return;

    const cert = verdict.certificate;
    expect(cert.mode).toBe("EXACT_ACTION");

    // 5. Authorized Dispatch via Gateway
    const liveState = cluster.getControllerVisibleState();
    const dispatchRes = await authorizedDispatch({
      certificate: cert,
      invocationProposal: proposal,
      requester: proposal.principal,
      liveState,
      livePolicyEpoch: k8sDrainNodePolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: controllerKeys.publicKey,
      currentTime: clock.now(),
    });

    expect(dispatchRes.status).toBe("EXECUTED");
    if (dispatchRes.status === "EXECUTED") {
      expect(dispatchRes.result.outcome).toBe("SUCCESS");
      expect(dispatchRes.result.details?.["cordoned"]).toBe(true);
    }

    // Verify cluster state was updated
    expect(cluster.getNode("node-worker-1")?.spec.unschedulable).toBe(true);
    expect(cluster.getPod("api-pod-1")).toBeUndefined(); // Pod evicted

    // 6. Verify Replay Rejection
    const replayRes = await authorizedDispatch({
      certificate: cert,
      invocationProposal: proposal,
      requester: proposal.principal,
      liveState,
      livePolicyEpoch: k8sDrainNodePolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: controllerKeys.publicKey,
      currentTime: clock.now(),
    });
    expect(replayRes.status).toBe("REJECTED");
    if (replayRes.status === "REJECTED") {
      expect(replayRes.reason).toMatch(/Replay (detected|rejection)/);
    }
  });
});
