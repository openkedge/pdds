import { randomUUID } from "node:crypto";
import type { Clock, EvidenceReceipt } from "@cac/schemas";
import { signEvidenceReceipt } from "@cac/evidence";
import type { KubernetesClusterModel } from "./clientModel.js";

export interface K8sObserverConfig {
  sourceIdentifier: string;
  signingKeyOrSecret: string;
  signingMethod: "ED25519" | "HMAC_SHA256" | "LOCAL_TCB";
  signerPublicKey?: string;
}

export class KubernetesTelemetryObserver {
  private cluster: KubernetesClusterModel;
  private clock: Clock;
  private config: K8sObserverConfig;

  constructor(cluster: KubernetesClusterModel, clock: Clock, config: K8sObserverConfig) {
    this.cluster = cluster;
    this.clock = clock;
    this.config = config;
  }

  public async inspectNode(nodeName: string): Promise<EvidenceReceipt> {
    const node = this.cluster.getNode(nodeName);
    const isReady = node?.status.conditions.some((c) => c.type === "Ready" && c.status === "True") ?? false;
    const isSchedulable = node ? !node.spec.unschedulable : false;
    const resourceVersion = node?.metadata.resourceVersion ?? "0";

    const podsOnNode = Array.from(this.cluster.pods.values())
      .filter((p) => p.spec.nodeName === nodeName)
      .map((p) => p.metadata.name);

    const unsigned = {
      id: `rec-k8s-node-${randomUUID()}`,
      claim: {
        clusterName: this.cluster.clusterName,
        nodeName,
        ready: isReady,
        schedulable: isSchedulable,
        resourceVersion,
        podsOnNode,
      },
      evidenceClass: "KUBERNETES_OBSERVATION" as const,
      source: this.config.sourceIdentifier,
      provenance: {
        tool: "kubectl.get.node",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [
        `kubernetes/${this.cluster.clusterName}`,
        `kubernetes/${this.cluster.clusterName}/node/${nodeName}`,
      ],
      observedAt: this.clock.now(),
      stateVersion: String(this.cluster.getCurrentVersionCounter()),
      dependencies: [],
    };

    return signEvidenceReceipt(
      unsigned,
      this.config.signingKeyOrSecret,
      this.config.signingMethod,
      this.config.signerPublicKey
    );
  }

  public async inspectPDB(pdbName: string): Promise<EvidenceReceipt> {
    const pdb = this.cluster.getPDB(pdbName);
    const disruptionsAllowed = pdb?.status.disruptionsAllowed ?? 0;
    const currentHealthy = pdb?.status.currentHealthy ?? 0;
    const desiredHealthy = pdb?.status.desiredHealthy ?? 0;
    const resourceVersion = pdb?.metadata.resourceVersion ?? "0";

    const unsigned = {
      id: `rec-k8s-pdb-${randomUUID()}`,
      claim: {
        clusterName: this.cluster.clusterName,
        pdbName,
        disruptionsAllowed,
        currentHealthy,
        desiredHealthy,
        resourceVersion,
      },
      evidenceClass: "KUBERNETES_OBSERVATION" as const,
      source: this.config.sourceIdentifier,
      provenance: {
        tool: "kubectl.get.pdb",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [
        `kubernetes/${this.cluster.clusterName}`,
        `kubernetes/${this.cluster.clusterName}/pdb/${pdbName}`,
      ],
      observedAt: this.clock.now(),
      stateVersion: String(this.cluster.getCurrentVersionCounter()),
      dependencies: [],
    };

    return signEvidenceReceipt(
      unsigned,
      this.config.signingKeyOrSecret,
      this.config.signingMethod,
      this.config.signerPublicKey
    );
  }

  public async inspectDeployment(depName: string): Promise<EvidenceReceipt> {
    const dep = this.cluster.getDeployment(depName);
    const replicas = dep?.spec.replicas ?? 0;
    const readyReplicas = dep?.status.readyReplicas ?? 0;
    const updatedReplicas = dep?.status.updatedReplicas ?? 0;
    const resourceVersion = dep?.metadata.resourceVersion ?? "0";

    const unsigned = {
      id: `rec-k8s-deploy-${randomUUID()}`,
      claim: {
        clusterName: this.cluster.clusterName,
        deploymentName: depName,
        replicas,
        readyReplicas,
        updatedReplicas,
        resourceVersion,
      },
      evidenceClass: "KUBERNETES_OBSERVATION" as const,
      source: this.config.sourceIdentifier,
      provenance: {
        tool: "kubectl.get.deployment",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [
        `kubernetes/${this.cluster.clusterName}`,
        `kubernetes/${this.cluster.clusterName}/deployment/${depName}`,
      ],
      observedAt: this.clock.now(),
      stateVersion: String(this.cluster.getCurrentVersionCounter()),
      dependencies: [],
    };

    return signEvidenceReceipt(
      unsigned,
      this.config.signingKeyOrSecret,
      this.config.signingMethod,
      this.config.signerPublicKey
    );
  }

  public async inspectNetworkPolicy(policyName: string): Promise<EvidenceReceipt> {
    const np = this.cluster.getNetworkPolicy(policyName);
    const resourceVersion = np?.metadata.resourceVersion ?? "0";

    const unsigned = {
      id: `rec-k8s-netpol-${randomUUID()}`,
      claim: {
        clusterName: this.cluster.clusterName,
        networkPolicyName: policyName,
        rulesJson: np ? JSON.stringify(np.spec) : "{}",
        resourceVersion,
      },
      evidenceClass: "KUBERNETES_OBSERVATION" as const,
      source: this.config.sourceIdentifier,
      provenance: {
        tool: "kubectl.get.networkpolicy",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [
        `kubernetes/${this.cluster.clusterName}`,
        `kubernetes/${this.cluster.clusterName}/networkpolicy/${policyName}`,
      ],
      observedAt: this.clock.now(),
      stateVersion: String(this.cluster.getCurrentVersionCounter()),
      dependencies: [],
    };

    return signEvidenceReceipt(
      unsigned,
      this.config.signingKeyOrSecret,
      this.config.signingMethod,
      this.config.signerPublicKey
    );
  }
}
