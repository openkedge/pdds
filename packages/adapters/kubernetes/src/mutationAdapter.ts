import { randomUUID } from "node:crypto";
import type { ControllerVisibleState } from "@cac/schemas";
import type { ExecutionResult, TargetExecutionAdapter } from "@cac/gateway";
import type { KubernetesClusterModel } from "./clientModel.js";

export interface KubernetesAdapterConfig {
  dryRun?: boolean;
}

export class KubernetesMutationAdapter implements TargetExecutionAdapter {
  private cluster: KubernetesClusterModel;
  private config: KubernetesAdapterConfig;

  constructor(cluster: KubernetesClusterModel, config: KubernetesAdapterConfig = {}) {
    this.cluster = cluster;
    this.config = config;
  }

  public getLiveState(): ControllerVisibleState {
    return this.cluster.getControllerVisibleState();
  }

  public async execute(action: string, params: Record<string, unknown>): Promise<ExecutionResult> {
    const expectedResourceVersion = params["expectedResourceVersion"] as string | undefined;

    // Issue a single-dispatch execution token from the mediated execution pathway
    const dispatchToken = `cac-token-${randomUUID()}`;
    this.cluster.registerAuthorizedDispatchToken(dispatchToken);

    try {
      switch (action) {
        case "DrainNode": {
          const nodeName = params["nodeName"] as string;
          if (!nodeName) {
            return { outcome: "FAILED", error: "Missing required parameter 'nodeName'" };
          }
          const node = this.cluster.getNode(nodeName);
          if (!node) {
            return { outcome: "FAILED", error: `Node '${nodeName}' not found` };
          }

          // Mode B: Optimistic concurrency / state version condition
          if (expectedResourceVersion && node.metadata.resourceVersion !== expectedResourceVersion) {
            return {
              outcome: "FAILED",
              error: `Mode B conflict: live resourceVersion ${node.metadata.resourceVersion} != expected ${expectedResourceVersion}`,
            };
          }

          // Live guard: Check PDBs for pods running on this node
          const podsOnNode = Array.from(this.cluster.pods.values()).filter(
            (p) => p.spec.nodeName === nodeName
          );

          for (const pod of podsOnNode) {
            for (const pdb of this.cluster.pdbs.values()) {
              // Match selector
              const matches = Object.entries(pdb.spec.selector.matchLabels).every(
                ([k, v]) => pod.metadata.labels?.[k] === v
              );
              if (matches && pdb.status.disruptionsAllowed <= 0) {
                return {
                  outcome: "FAILED",
                  error: `Guard violation: PDB '${pdb.metadata.name}' has disruptionsAllowed=${pdb.status.disruptionsAllowed}`,
                };
              }
            }
          }

          if (this.config.dryRun) {
            return { outcome: "SUCCESS", details: { dryRun: true, nodeName } };
          }

          // Step 1: Cordon node
          this.cluster.updateNode(
            nodeName,
            (n) => {
              n.spec.unschedulable = true;
            },
            expectedResourceVersion,
            dispatchToken
          );

          // Step 2: Evict pods (each eviction gets a sub-token)
          for (const pod of podsOnNode) {
            const evictToken = `cac-token-evict-${randomUUID()}`;
            this.cluster.registerAuthorizedDispatchToken(evictToken);
            this.cluster.evictPod(pod.metadata.name, evictToken);
          }

          return {
            outcome: "SUCCESS",
            details: {
              nodeName,
              cordoned: true,
              evictedPods: podsOnNode.map((p) => p.metadata.name),
              newResourceVersion: this.cluster.getNode(nodeName)?.metadata.resourceVersion,
            },
          };
        }

        case "RolloutDeployment": {
          const deploymentName = params["deploymentName"] as string;
          const image = params["image"] as string;
          if (!deploymentName) {
            return { outcome: "FAILED", error: "Missing required parameter 'deploymentName'" };
          }
          const dep = this.cluster.getDeployment(deploymentName);
          if (!dep) {
            return { outcome: "FAILED", error: `Deployment '${deploymentName}' not found` };
          }

          // Mode B: Concurrency check
          if (expectedResourceVersion && dep.metadata.resourceVersion !== expectedResourceVersion) {
            return {
              outcome: "FAILED",
              error: `Mode B conflict: live resourceVersion ${dep.metadata.resourceVersion} != expected ${expectedResourceVersion}`,
            };
          }

          if (this.config.dryRun) {
            return { outcome: "SUCCESS", details: { dryRun: true, deploymentName } };
          }

          this.cluster.updateDeployment(
            deploymentName,
            (d) => {
              if (image && d.spec.template.spec.containers[0]) {
                d.spec.template.spec.containers[0].image = image;
              }
              d.status.observedGeneration = (d.status.observedGeneration ?? 1) + 1;
            },
            expectedResourceVersion,
            dispatchToken
          );

          return {
            outcome: "SUCCESS",
            details: {
              deploymentName,
              newResourceVersion: this.cluster.getDeployment(deploymentName)?.metadata.resourceVersion,
            },
          };
        }

        case "ApplyNetworkPolicy": {
          const policyName = params["policyName"] as string;
          const spec = params["spec"] as any;
          if (!policyName || !spec) {
            return { outcome: "FAILED", error: "Missing required parameters 'policyName' or 'spec'" };
          }

          const existing = this.cluster.getNetworkPolicy(policyName);
          if (existing) {
            if (expectedResourceVersion && existing.metadata.resourceVersion !== expectedResourceVersion) {
              return {
                outcome: "FAILED",
                error: `Mode B conflict: live resourceVersion ${existing.metadata.resourceVersion} != expected ${expectedResourceVersion}`,
              };
            }
            this.cluster.updateNetworkPolicy(
              policyName,
              (np) => {
                np.spec = spec;
              },
              expectedResourceVersion,
              dispatchToken
            );
          } else {
            const review = this.cluster.reviewAdmission(
              {
                uid: randomUUID(),
                operation: "CREATE",
                resource: { group: "networking.k8s.io", version: "v1", resource: "networkpolicies" },
                name: policyName,
              },
              dispatchToken
            );
            if (!review.allowed) {
              return { outcome: "FAILED", error: review.status?.message ?? "Admission rejected" };
            }
            this.cluster.addNetworkPolicy({
              metadata: { name: policyName, resourceVersion: "1" },
              spec,
            });
          }

          return {
            outcome: "SUCCESS",
            details: {
              policyName,
              newResourceVersion: this.cluster.getNetworkPolicy(policyName)?.metadata.resourceVersion,
            },
          };
        }

        default:
          return {
            outcome: "FAILED",
            error: `Unsupported Kubernetes action: '${action}'`,
          };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        outcome: "FAILED",
        error: msg,
      };
    }
  }
}
