import { randomUUID } from "node:crypto";
import type { ControllerVisibleState, K8sLiveState } from "@cac/schemas";
import type {
  K8sDeployment,
  K8sNetworkPolicy,
  K8sNode,
  K8sPod,
  K8sPodDisruptionBudget,
  AdmissionWebhookReviewRequest,
  AdmissionWebhookReviewResponse,
} from "./types.js";

export interface K8sClusterConfig {
  clusterName: string;
  enforceCompleteMediation?: boolean;
}

export class KubernetesClusterModel {
  public readonly clusterName: string;
  private enforceCompleteMediation: boolean;
  private currentVersionCounter: number = 1;

  public nodes = new Map<string, K8sNode>();
  public pods = new Map<string, K8sPod>();
  public deployments = new Map<string, K8sDeployment>();
  public pdbs = new Map<string, K8sPodDisruptionBudget>();
  public networkPolicies = new Map<string, K8sNetworkPolicy>();

  // Valid authorized tokens issued by CAC Gateway during mediated execution
  private activeDispatchTokens = new Set<string>();

  constructor(config: K8sClusterConfig) {
    this.clusterName = config.clusterName;
    this.enforceCompleteMediation = config.enforceCompleteMediation ?? true;
  }

  public getCurrentVersionCounter(): number {
    return this.currentVersionCounter;
  }

  public nextResourceVersion(): string {
    this.currentVersionCounter += 1;
    return String(this.currentVersionCounter);
  }

  public registerAuthorizedDispatchToken(tokenId: string): void {
    this.activeDispatchTokens.add(tokenId);
  }

  public revokeDispatchToken(tokenId: string): void {
    this.activeDispatchTokens.delete(tokenId);
  }

  /**
   * Admission Webhook: intercepts any mutation.
   * If complete mediation is enforced, requests must present an authorized CAC dispatch token.
   */
  public reviewAdmission(
    req: AdmissionWebhookReviewRequest,
    dispatchToken?: string
  ): AdmissionWebhookReviewResponse {
    if (!this.enforceCompleteMediation) {
      return { uid: req.uid, allowed: true };
    }

    if (!dispatchToken || !this.activeDispatchTokens.has(dispatchToken)) {
      return {
        uid: req.uid,
        allowed: false,
        status: {
          code: 403,
          message:
            "Complete mediation violation: raw mutation rejected without valid CAC single-dispatch token",
        },
      };
    }

    // Token is single-use: consume immediately
    this.activeDispatchTokens.delete(dispatchToken);
    return { uid: req.uid, allowed: true };
  }

  // Node operations
  public addNode(node: Omit<K8sNode, "apiVersion" | "kind">): K8sNode {
    if (node.metadata.resourceVersion) {
      const v = parseInt(node.metadata.resourceVersion, 10);
      if (!isNaN(v) && v > this.currentVersionCounter) {
        this.currentVersionCounter = v;
      }
    }
    const fullNode: K8sNode = {
      apiVersion: "v1",
      kind: "Node",
      metadata: {
        ...node.metadata,
        resourceVersion: node.metadata.resourceVersion || this.nextResourceVersion(),
      },
      spec: node.spec,
      status: node.status,
    };
    this.nodes.set(fullNode.metadata.name, fullNode);
    return fullNode;
  }

  public getNode(name: string): K8sNode | undefined {
    return this.nodes.get(name);
  }

  public updateNode(
    name: string,
    mutator: (node: K8sNode) => void,
    expectedResourceVersion?: string,
    dispatchToken?: string
  ): K8sNode {
    const node = this.nodes.get(name);
    if (!node) {
      throw new Error(`Node '${name}' not found`);
    }

    const review = this.reviewAdmission(
      {
        uid: randomUUID(),
        operation: "UPDATE",
        resource: { group: "", version: "v1", resource: "nodes" },
        name,
      },
      dispatchToken
    );
    if (!review.allowed) {
      throw new Error(review.status?.message ?? "Admission rejected");
    }

    if (expectedResourceVersion && node.metadata.resourceVersion !== expectedResourceVersion) {
      throw new Error(
        `Optimistic concurrency conflict on node '${name}': expected resourceVersion ${expectedResourceVersion}, found ${node.metadata.resourceVersion}`
      );
    }

    mutator(node);
    node.metadata.resourceVersion = this.nextResourceVersion();
    return node;
  }

  // Pod operations
  public addPod(pod: Omit<K8sPod, "apiVersion" | "kind">): K8sPod {
    const fullPod: K8sPod = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        ...pod.metadata,
        resourceVersion: pod.metadata.resourceVersion || this.nextResourceVersion(),
      },
      spec: pod.spec,
      status: pod.status,
    };
    this.pods.set(fullPod.metadata.name, fullPod);
    return fullPod;
  }

  public getPod(name: string): K8sPod | undefined {
    return this.pods.get(name);
  }

  public evictPod(name: string, dispatchToken?: string): boolean {
    const pod = this.pods.get(name);
    if (!pod) return false;

    const review = this.reviewAdmission(
      {
        uid: randomUUID(),
        operation: "DELETE",
        resource: { group: "", version: "v1", resource: "pods/eviction" },
        name,
        namespace: pod.metadata.namespace,
      },
      dispatchToken
    );
    if (!review.allowed) {
      throw new Error(review.status?.message ?? "Admission rejected");
    }

    this.pods.delete(name);
    return true;
  }

  // Deployment operations
  public addDeployment(dep: Omit<K8sDeployment, "apiVersion" | "kind">): K8sDeployment {
    const fullDep: K8sDeployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        ...dep.metadata,
        resourceVersion: dep.metadata.resourceVersion || this.nextResourceVersion(),
      },
      spec: dep.spec,
      status: dep.status,
    };
    this.deployments.set(fullDep.metadata.name, fullDep);
    return fullDep;
  }

  public getDeployment(name: string): K8sDeployment | undefined {
    return this.deployments.get(name);
  }

  public updateDeployment(
    name: string,
    mutator: (dep: K8sDeployment) => void,
    expectedResourceVersion?: string,
    dispatchToken?: string
  ): K8sDeployment {
    const dep = this.deployments.get(name);
    if (!dep) {
      throw new Error(`Deployment '${name}' not found`);
    }

    const review = this.reviewAdmission(
      {
        uid: randomUUID(),
        operation: "UPDATE",
        resource: { group: "apps", version: "v1", resource: "deployments" },
        name,
        namespace: dep.metadata.namespace,
      },
      dispatchToken
    );
    if (!review.allowed) {
      throw new Error(review.status?.message ?? "Admission rejected");
    }

    if (expectedResourceVersion && dep.metadata.resourceVersion !== expectedResourceVersion) {
      throw new Error(
        `Optimistic concurrency conflict on deployment '${name}': expected resourceVersion ${expectedResourceVersion}, found ${dep.metadata.resourceVersion}`
      );
    }

    mutator(dep);
    dep.metadata.resourceVersion = this.nextResourceVersion();
    return dep;
  }

  // PDB operations
  public addPDB(pdb: Omit<K8sPodDisruptionBudget, "apiVersion" | "kind">): K8sPodDisruptionBudget {
    const fullPdb: K8sPodDisruptionBudget = {
      apiVersion: "policy/v1",
      kind: "PodDisruptionBudget",
      metadata: {
        ...pdb.metadata,
        resourceVersion: pdb.metadata.resourceVersion || this.nextResourceVersion(),
      },
      spec: pdb.spec,
      status: pdb.status,
    };
    this.pdbs.set(fullPdb.metadata.name, fullPdb);
    return fullPdb;
  }

  public getPDB(name: string): K8sPodDisruptionBudget | undefined {
    return this.pdbs.get(name);
  }

  // NetworkPolicy operations
  public addNetworkPolicy(netpol: Omit<K8sNetworkPolicy, "apiVersion" | "kind">): K8sNetworkPolicy {
    const fullNetpol: K8sNetworkPolicy = {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: {
        ...netpol.metadata,
        resourceVersion: netpol.metadata.resourceVersion || this.nextResourceVersion(),
      },
      spec: netpol.spec,
    };
    this.networkPolicies.set(fullNetpol.metadata.name, fullNetpol);
    return fullNetpol;
  }

  public getNetworkPolicy(name: string): K8sNetworkPolicy | undefined {
    return this.networkPolicies.get(name);
  }

  public updateNetworkPolicy(
    name: string,
    mutator: (np: K8sNetworkPolicy) => void,
    expectedResourceVersion?: string,
    dispatchToken?: string
  ): K8sNetworkPolicy {
    const np = this.networkPolicies.get(name);
    if (!np) {
      throw new Error(`NetworkPolicy '${name}' not found`);
    }

    const review = this.reviewAdmission(
      {
        uid: randomUUID(),
        operation: "UPDATE",
        resource: { group: "networking.k8s.io", version: "v1", resource: "networkpolicies" },
        name,
        namespace: np.metadata.namespace,
      },
      dispatchToken
    );
    if (!review.allowed) {
      throw new Error(review.status?.message ?? "Admission rejected");
    }

    if (expectedResourceVersion && np.metadata.resourceVersion !== expectedResourceVersion) {
      throw new Error(
        `Optimistic concurrency conflict on NetworkPolicy '${name}': expected resourceVersion ${expectedResourceVersion}, found ${np.metadata.resourceVersion}`
      );
    }

    mutator(np);
    np.metadata.resourceVersion = this.nextResourceVersion();
    return np;
  }

  /**
   * Returns live snapshot for gateway validation and observer telemetry.
   */
  public getLiveState(): K8sLiveState {
    const nodes: Record<string, any> = {};
    for (const [name, n] of this.nodes) {
      const isReady = n.status.conditions.some((c) => c.type === "Ready" && c.status === "True");
      nodes[name] = {
        ready: isReady,
        schedulable: !n.spec.unschedulable,
        capacityCpu: n.status.capacity?.["cpu"] ?? "4",
        capacityMemory: n.status.capacity?.["memory"] ?? "16Gi",
        resourceVersion: n.metadata.resourceVersion,
      };
    }

    const deployments: Record<string, any> = {};
    for (const [name, d] of this.deployments) {
      deployments[name] = {
        replicas: d.spec.replicas,
        readyReplicas: d.status.readyReplicas,
        updatedReplicas: d.status.updatedReplicas,
        resourceVersion: d.metadata.resourceVersion,
        generation: d.status.observedGeneration ?? 1,
        image: d.spec.template.spec.containers[0]?.image ?? "unknown",
      };
    }

    const pods: Record<string, any> = {};
    for (const [name, p] of this.pods) {
      pods[name] = {
        nodeName: p.spec.nodeName ?? "",
        phase: p.status.phase,
        isReady: p.status.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? true,
        labels: p.metadata.labels ?? {},
      };
    }

    const podDisruptionBudgets: Record<string, any> = {};
    for (const [name, pdb] of this.pdbs) {
      podDisruptionBudgets[name] = {
        minAvailable: pdb.spec.minAvailable,
        maxUnavailable: pdb.spec.maxUnavailable,
        disruptionsAllowed: pdb.status.disruptionsAllowed,
        currentHealthy: pdb.status.currentHealthy,
        desiredHealthy: pdb.status.desiredHealthy,
      };
    }

    const networkPolicies: Record<string, any> = {};
    for (const [name, np] of this.networkPolicies) {
      networkPolicies[name] = {
        resourceVersion: np.metadata.resourceVersion,
        rulesJson: JSON.stringify(np.spec),
      };
    }

    return {
      clusterName: this.clusterName,
      observedEpoch: String(this.currentVersionCounter),
      nodes,
      deployments,
      pods,
      podDisruptionBudgets,
      networkPolicies,
    };
  }

  public getControllerVisibleState(): ControllerVisibleState {
    const k8s = this.getLiveState();
    return {
      clusterId: this.clusterName,
      observedVersion: k8s.observedEpoch,
      activeNodes: Object.keys(k8s.nodes),
      candidateRole: "unknown",
      replicationEpoch: this.currentVersionCounter,
      k8sState: k8s,
    };
  }
}
