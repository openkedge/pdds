import type { ControllerVisibleState } from "@cac/schemas";

export interface NodeState {
  role: "primary" | "standby" | "offline";
  isInRecovery: boolean;
  walLsn: string;
  replicationLagBytes: number;
  timeline: number;
}

export interface BackupArtifact {
  snapshotId: string;
  epochMs: number;
  valid: boolean;
}

export interface InjectedFaults {
  replicationLagSpikeBytes?: number;
  standbyCrash?: boolean;
  roleDrift?: "primary" | "offline";
  promotionTimeout?: boolean;
  networkDrop?: boolean;
}

/**
 * High-fidelity PostgreSQL cluster model for telemetry observation and failover mutations.
 */
export class PostgresClusterModel {
  readonly clusterId: string;
  private primaryNode: string;
  private nodes = new Map<string, NodeState>();
  private backupArtifact: BackupArtifact;
  private replicationEpoch: number = 1;
  private faults: InjectedFaults = {};

  constructor(
    clusterId: string = "prod-cluster-a",
    primaryNode: string = "replica-01",
    standbyNode: string = "replica-02"
  ) {
    this.clusterId = clusterId;
    this.primaryNode = primaryNode;

    this.nodes.set(primaryNode, {
      role: "primary",
      isInRecovery: false,
      walLsn: "lsn:0/3000000",
      replicationLagBytes: 0,
      timeline: 1,
    });

    this.nodes.set(standbyNode, {
      role: "standby",
      isInRecovery: true,
      walLsn: "lsn:0/3000000",
      replicationLagBytes: 512, // 512 bytes lag by default
      timeline: 1,
    });

    this.backupArtifact = {
      snapshotId: "snap-prod-cluster-a-latest",
      epochMs: Date.now() - 5000,
      valid: true,
    };
  }

  injectFault(faults: InjectedFaults): void {
    this.faults = { ...this.faults, ...faults };
  }

  clearFaults(): void {
    this.faults = {};
  }

  getNode(nodeId: string): NodeState | undefined {
    const base = this.nodes.get(nodeId);
    if (!base) return undefined;
    const copy = { ...base };

    if (nodeId !== this.primaryNode && this.faults.replicationLagSpikeBytes !== undefined) {
      copy.replicationLagBytes = this.faults.replicationLagSpikeBytes;
    }
    if (this.faults.standbyCrash && nodeId !== this.primaryNode) {
      copy.role = "offline";
      copy.isInRecovery = false;
    }
    if (this.faults.roleDrift && nodeId !== this.primaryNode) {
      copy.role = this.faults.roleDrift;
      copy.isInRecovery = false;
    }

    return copy;
  }

  getBackupArtifact(): BackupArtifact {
    return { ...this.backupArtifact };
  }

  getPrimaryNode(): string {
    return this.primaryNode;
  }

  getControllerVisibleState(candidateStandby: string): ControllerVisibleState {
    const candidate = this.getNode(candidateStandby);
    return {
      clusterId: this.clusterId,
      observedVersion: candidate ? candidate.walLsn : "lsn:0/3000000",
      activeNodes: Array.from(this.nodes.keys()),
      candidateRole: candidate ? candidate.role : "unknown",
      replicationEpoch: this.replicationEpoch,
    };
  }

  async promoteStandby(candidateStandby: string): Promise<{ success: boolean; error?: string }> {
    if (this.faults.promotionTimeout || this.faults.networkDrop) {
      // Simulates ambiguous outcome (F10)
      throw new Error("PostgreSQL promotion timeout: connection to cluster timed out during failover handshake");
    }

    const candidate = this.nodes.get(candidateStandby);
    if (!candidate) {
      return { success: false, error: `Candidate standby '${candidateStandby}' not found` };
    }
    if (candidate.role !== "standby" || !candidate.isInRecovery) {
      return {
        success: false,
        error: `Candidate '${candidateStandby}' is not in standby recovery mode (role=${candidate.role})`,
      };
    }

    // Step down old primary
    const oldPrimary = this.nodes.get(this.primaryNode);
    if (oldPrimary) {
      oldPrimary.role = "standby";
      oldPrimary.isInRecovery = true;
    }

    // Promote new primary
    candidate.role = "primary";
    candidate.isInRecovery = false;
    candidate.timeline += 1;
    this.primaryNode = candidateStandby;
    this.replicationEpoch += 1;

    return { success: true };
  }
}
