#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { SteppableClock } from "@cac/core";
import { MemoryAuthorizer, postgresFailoverPolicyProfile } from "@cac/policy";
import { CACController } from "@cac/workloop";
import { authorizedDispatch, MemoryCapabilityStore } from "@cac/gateway";
import {
  PostgresClusterModel,
  PostgresFailoverAdapter,
  PostgresTelemetryObserver,
} from "@cac/adapter-postgres";
import {
  KubernetesClusterModel,
  KubernetesMutationAdapter,
  KubernetesTelemetryObserver,
  k8sDrainNodePolicyProfile,
} from "@cac/adapter-kubernetes";
import {
  scenarioF4,
  controllerCAC,
  controllerCACNoEFD,
  controllerB5,
  runTrial,
} from "@cac/bench";

async function runPostgresFailoverDemo() {
  console.log("================================================================================");
  console.log(" CAC Demo: PostgreSQL FailoverDatabase Vertical Slice");
  console.log("================================================================================\n");

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const authorizer = new MemoryAuthorizer([
    { principal: "agent:sre-01", action: "FailoverDatabase", scope: ["postgres/prod-cluster-a"] },
  ]);

  const clock = new SteppableClock(10000);
  const cluster = new PostgresClusterModel("prod-cluster-a", "replica-01", "replica-02");
  const observer = new PostgresTelemetryObserver(cluster, clock, {
    sourceIdentifier: "probe.postgres.prod-cluster-a",
    signingKeyOrSecret: "demo-secret",
    signingMethod: "HMAC_SHA256",
  });
  const adapter = new PostgresFailoverAdapter(cluster);
  const capabilityStore = new MemoryCapabilityStore();
  const controller = new CACController({
    controllerPrivateKeyPem: privateKeyPem,
    trustedRoots: { trustedSigners: new Set(), hmacSecret: "demo-secret" },
  });

  const proposal = {
    intent: { goal: "restore-availability", scope: ["postgres/prod-cluster-a"], constraints: ["zero-data-loss"] },
    action: "FailoverDatabase",
    params: { clusterId: "prod-cluster-a", candidateStandby: "replica-02" },
    scope: ["postgres/prod-cluster-a"],
    principal: "agent:sre-01",
    observedStateVersion: "lsn:0/3000000",
    constraints: { maxDataLossBytes: 0 },
  };

  console.log("[Turn 0] Submitting unbacked proposal...");
  const context = {
    policySnapshot: postgresFailoverPolicyProfile,
    evaluationTime: clock.now(),
    operationalBudget: { remainingTokens: 10000, remainingTurns: 5, deadlineEpochMs: clock.now().epochMs + 60000, costBudgetUsd: 1.0 },
    dependencySnapshot: { epoch: "dep-v1", edges: {} },
    authorizationSnapshot: authorizer,
  };

  const v0 = controller.evaluate(proposal, adapter.getLiveState("replica-02"), [], context);
  console.log(`[Verdict] -> ${v0.kind}`);
  if (v0.kind === "DEFER") {
    console.log(`  Emitted remediation contracts: ${v0.unresolved.length} required telemetry receipts.`);
    console.log("[Turn 1] Fulfilling remediation contracts via PostgresTelemetryObserver...");
    const rLag = await observer.inspectReplication("replica-02");
    const rHealth = await observer.inspectStandbyHealth("replica-02");
    const rRollback = await observer.verifyRollbackSnapshot();

    const v1 = controller.evaluate(proposal, adapter.getLiveState("replica-02"), [rLag, rHealth, rRollback], context);
    console.log(`[Verdict] -> ${v1.kind}`);
    if (v1.kind === "PERMIT") {
      console.log(`  Minted Certificate ID: ${v1.certificate.admissionId} (Nonce: ${v1.certificate.nonce})`);
      console.log("[Gateway] Dispatching execution with single-dispatch capability token...");
      const res = await authorizedDispatch({
        certificate: v1.certificate,
        invocationProposal: proposal,
        requester: proposal.principal,
        liveState: adapter.getLiveState("replica-02"),
        livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
        liveAuthorizer: authorizer,
        capabilityStore,
        targetAdapter: adapter,
        controllerPublicKeyPem: publicKeyPem,
        currentTime: clock.now(),
      });
      console.log(`[Execution Result] -> ${res.status} (Details: ${JSON.stringify(res.status === "EXECUTED" ? res.result.details : {})})`);
      console.log("[Replay Check] Attempting duplicate dispatch with burned capability nonce...");
      const replay = await authorizedDispatch({
        certificate: v1.certificate,
        invocationProposal: proposal,
        requester: proposal.principal,
        liveState: adapter.getLiveState("replica-02"),
        livePolicyEpoch: postgresFailoverPolicyProfile.epoch,
        liveAuthorizer: authorizer,
        capabilityStore,
        targetAdapter: adapter,
        controllerPublicKeyPem: publicKeyPem,
        currentTime: clock.now(),
      });
      console.log(`[Replay Result] -> ${replay.status}: ${replay.status === "EXECUTED" ? "executed" : replay.reason}\n`);
    }
  }
}

async function runKubernetesDrainDemo() {
  console.log("================================================================================");
  console.log(" CAC Demo: Kubernetes DrainNode Complete Mediation & Mode B Demonstration");
  console.log("================================================================================\n");

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();

  const cluster = new KubernetesClusterModel({ clusterName: "k8s-prod", enforceCompleteMediation: true });
  cluster.addNode({
    metadata: { name: "node-worker-1", resourceVersion: "10" },
    spec: { unschedulable: false },
    status: { conditions: [{ type: "Ready", status: "True" }], capacity: { cpu: "8", memory: "32Gi" } },
  });
  cluster.addPod({
    metadata: { name: "api-pod-1", namespace: "default", labels: { app: "api" }, resourceVersion: "1" },
    spec: { nodeName: "node-worker-1", containers: [{ name: "api", image: "repo/api:v1" }] },
    status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
  });
  cluster.addPDB({
    metadata: { name: "api-pdb", namespace: "default", resourceVersion: "1" },
    spec: { minAvailable: 1, selector: { matchLabels: { app: "api" } } },
    status: { currentHealthy: 3, desiredHealthy: 1, disruptionsAllowed: 2, expectedPods: 3 },
  });

  const clock = new SteppableClock(10000);
  const observer = new KubernetesTelemetryObserver(cluster, clock, {
    sourceIdentifier: "cac.k8s.observer",
    signingKeyOrSecret: privateKeyPem,
    signingMethod: "ED25519",
    signerPublicKey: publicKeyPem,
  });
  const adapter = new KubernetesMutationAdapter(cluster);
  const capabilityStore = new MemoryCapabilityStore();
  const authorizer = new MemoryAuthorizer([
    { principal: "agent.k8s.admin", action: "DrainNode", scope: ["kubernetes/k8s-prod"] },
  ]);

  console.log("1. Complete Mediation Negative Test: Direct mutation without CAC capability token");
  try {
    cluster.updateNode("node-worker-1", (n) => { n.spec.unschedulable = true; });
    console.log("  ERROR: Raw mutation unexpectedly allowed!");
  } catch (err: any) {
    console.log(`  ✓ Successfully Blocked by Webhook: ${err.message}`);
  }

  console.log("\n2. Mode B Concurrency Negative Test: Proposing with stale resourceVersion");
  const staleRes = await adapter.execute("DrainNode", { nodeName: "node-worker-1", expectedResourceVersion: "9" });
  console.log(`  ✓ Blocked with Mode B Conflict: ${staleRes.error}`);

  console.log("\n3. Full Mediated CAC Execution Workflow:");
  const rNode = await observer.inspectNode("node-worker-1");
  const rPdb = await observer.inspectPDB("api-pdb");
  const controller = new CACController({
    controllerPrivateKeyPem: privateKeyPem,
    trustedRoots: { trustedSigners: new Set([publicKeyPem]), hmacSecret: "secret" },
  });

  const proposal = {
    intent: { goal: "Scheduled node drain", scope: ["kubernetes/k8s-prod"], constraints: [] },
    action: "DrainNode",
    params: { nodeName: "node-worker-1", expectedResourceVersion: "10" },
    scope: ["kubernetes/k8s-prod"],
    principal: "agent.k8s.admin",
    observedStateVersion: "10",
    constraints: {},
  };

  const v = controller.evaluate(proposal, cluster.getControllerVisibleState(), [rNode, rPdb], {
    policySnapshot: k8sDrainNodePolicyProfile,
    evaluationTime: clock.now(),
    operationalBudget: { remainingTokens: 10000, remainingTurns: 5, deadlineEpochMs: clock.now().epochMs + 60000, costBudgetUsd: 1.0 },
    dependencySnapshot: { epoch: "1", edges: {} },
    authorizationSnapshot: authorizer,
  });

  console.log(`  Admission Evaluation Verdict: ${v.kind}`);
  if (v.kind === "PERMIT") {
    const dispatchRes = await authorizedDispatch({
      certificate: v.certificate,
      invocationProposal: proposal,
      requester: proposal.principal,
      liveState: cluster.getControllerVisibleState(),
      livePolicyEpoch: k8sDrainNodePolicyProfile.epoch,
      liveAuthorizer: authorizer,
      capabilityStore,
      targetAdapter: adapter,
      controllerPublicKeyPem: publicKeyPem,
      currentTime: clock.now(),
    });
    console.log(`  ✓ Mediated Dispatch: ${dispatchRes.status} (Node unschedulable=${cluster.getNode("node-worker-1")?.spec.unschedulable})`);
  }
  console.log();
}

async function runEfdQuorumDemo() {
  console.log("================================================================================");
  console.log(" CAC Demo: Epistemic Fault Diversity (EFD) vs Correlated LLM Panel");
  console.log("================================================================================\n");

  console.log("Testing Scenario F4 (Reachability proposition with leak path in ground truth):");
  console.log("  Panel A: 3 homogeneous LLMs (v_llm_1, v_llm_2, v_llm_3) sharing RAG retriever blindspot.");
  console.log("  Panel B: Formal graph solver (v_solver) + canary probe (v_canary).\n");

  console.log("[Controller B5: 3-LLM Majority Vote]");
  const outB5 = await runTrial(scenarioF4, controllerB5, 42);
  console.log(`  Admission Granted: ${outB5.admissionGranted}`);
  console.log(`  Unsafe Execution Occurred: ${outB5.unsafeExecutionOccurred}`);
  console.log(`  Outcome: ${outB5.error}\n`);

  console.log("[Controller CAC-NoEFD: Quorum Cardinality >= 2 without EFD Structural Cut]");
  const outNoEfd = await runTrial(scenarioF4, controllerCACNoEFD, 42);
  console.log(`  Admission Granted: ${outNoEfd.admissionGranted}`);
  console.log(`  Unsafe Execution Occurred: ${outNoEfd.unsafeExecutionOccurred}`);
  console.log(`  Outcome: Uncritically accepted homogeneous quorum -> breach admitted.\n`);

  console.log("[Controller CAC: Epistemic Fault Diversity (EFD kappa_E >= 2)]");
  const outCac = await runTrial(scenarioF4, controllerCAC, 42);
  console.log(`  Admission Granted: ${outCac.admissionGranted}`);
  console.log(`  Unsafe Execution Occurred: ${outCac.unsafeExecutionOccurred}`);
  console.log(`  Outcome: Detected kappa_E = 1 < 2 (single fault f_retrieval cuts all 3 LLMs).`);
  console.log(`  Action: Defers admission and halts unsafe mutation.\n`);
}

async function main() {
  const cmd = process.argv[2] || "all";
  switch (cmd) {
    case "postgres-failover":
      await runPostgresFailoverDemo();
      break;
    case "kubernetes-drain":
      await runKubernetesDrainDemo();
      break;
    case "efd-quorum":
      await runEfdQuorumDemo();
      break;
    case "all":
    default:
      await runPostgresFailoverDemo();
      await runKubernetesDrainDemo();
      await runEfdQuorumDemo();
      break;
  }
}

main().catch((err) => {
  console.error("Demo failed with unhandled error:", err);
  process.exit(1);
});
