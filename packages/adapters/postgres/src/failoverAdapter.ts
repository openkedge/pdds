import type { ControllerVisibleState } from "@cac/schemas";
import type { ExecutionResult, TargetExecutionAdapter } from "@cac/gateway";
import type { PostgresClusterModel } from "./clusterModel.js";

export interface FailoverAdapterConfig {
  mode: "SIMULATED" | "REAL";
  dryRun?: boolean;
}

/**
 * PostgreSQL Failover Execution Adapter
 * Exposes live state for gateway guard verification and executes failovers only via gateway mediation.
 */
export class PostgresFailoverAdapter implements TargetExecutionAdapter {
  private cluster: PostgresClusterModel;
  private config: FailoverAdapterConfig;

  constructor(cluster: PostgresClusterModel, config: FailoverAdapterConfig = { mode: "SIMULATED" }) {
    this.cluster = cluster;
    this.config = config;
  }

  /**
   * Exposes live controller-visible state for gateway guard checking immediately before dispatch.
   */
  getLiveState(candidateStandby: string): ControllerVisibleState {
    return this.cluster.getControllerVisibleState(candidateStandby);
  }

  /**
   * Executes the mediated FailoverDatabase operation.
   * Direct agent invocation of this method is prevented by credential/network confinement in the TCB.
   */
  async execute(action: string, params: Record<string, unknown>): Promise<ExecutionResult> {
    if (action !== "FailoverDatabase") {
      return {
        outcome: "FAILED",
        error: `Unsupported action '${action}' for PostgresFailoverAdapter`,
      };
    }

    const clusterId = params["clusterId"] as string;
    const candidateStandby = params["candidateStandby"] as string;

    if (!clusterId || !candidateStandby) {
      return {
        outcome: "FAILED",
        error: "Missing required parameters 'clusterId' or 'candidateStandby'",
      };
    }

    if (clusterId !== this.cluster.clusterId) {
      return {
        outcome: "FAILED",
        error: `Cluster ID mismatch: target cluster '${clusterId}' != adapter cluster '${this.cluster.clusterId}'`,
      };
    }

    if (this.config.dryRun) {
      return {
        outcome: "SUCCESS",
        details: {
          dryRun: true,
          clusterId,
          promotedStandby: candidateStandby,
        },
      };
    }

    try {
      const promotionResult = await this.cluster.promoteStandby(candidateStandby);
      if (!promotionResult.success) {
        return {
          outcome: "FAILED",
          error: promotionResult.error ?? "Standby promotion failed",
        };
      }

      return {
        outcome: "SUCCESS",
        details: {
          clusterId,
          promotedNode: candidateStandby,
          newPrimary: this.cluster.getPrimaryNode(),
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("connection reset")) {
        return {
          outcome: "AMBIGUOUS",
          error: msg,
          details: { clusterId, candidateStandby },
        };
      }
      return {
        outcome: "FAILED",
        error: msg,
      };
    }
  }
}
