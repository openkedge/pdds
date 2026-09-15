import { randomUUID } from "node:crypto";
import type { Clock, EvidenceReceipt } from "@cac/schemas";
import { signEvidenceReceipt } from "@cac/evidence";
import type { PostgresClusterModel } from "./clusterModel.js";

export interface ObserverConfig {
  sourceIdentifier: string;
  signingKeyOrSecret: string;
  signingMethod: "ED25519" | "HMAC_SHA256" | "LOCAL_TCB";
  signerPublicKey?: string;
}

/**
 * PostgreSQL Telemetry Observer Adapter
 * Connects to PostgreSQL telemetry channels and produces signed evidence receipts.
 * Outside the deterministic discharge core.
 */
export class PostgresTelemetryObserver {
  private cluster: PostgresClusterModel;
  private clock: Clock;
  private config: ObserverConfig;

  constructor(cluster: PostgresClusterModel, clock: Clock, config: ObserverConfig) {
    this.cluster = cluster;
    this.clock = clock;
    this.config = config;
  }

  /**
   * Probes replication lag between primary and candidate standby node.
   */
  async inspectReplication(candidateStandby: string): Promise<EvidenceReceipt> {
    const candidate = this.cluster.getNode(candidateStandby);
    const lagBytes = candidate ? candidate.replicationLagBytes : 0;
    const lsn = candidate ? candidate.walLsn : "lsn:0/3000000";

    const unsigned = {
      id: `rec-lag-${randomUUID()}`,
      claim: {
        clusterId: this.cluster.clusterId,
        candidateStandby,
        replicationLagBytes: lagBytes,
        currentLsn: lsn,
      },
      evidenceClass: "POSTGRES_TELEMETRY" as const,
      source: this.config.sourceIdentifier,
      provenance: {
        tool: "pg_stat_replication",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [`postgres/${this.cluster.clusterId}`],
      observedAt: this.clock.now(),
      stateVersion: lsn,
      dependencies: [],
    };

    return signEvidenceReceipt(
      unsigned,
      this.config.signingKeyOrSecret,
      this.config.signingMethod,
      this.config.signerPublicKey
    );
  }

  /**
   * Probes candidate replica health: pg_is_in_recovery() and role.
   */
  async inspectStandbyHealth(candidateStandby: string): Promise<EvidenceReceipt> {
    const candidate = this.cluster.getNode(candidateStandby);
    const isInRecovery = candidate ? candidate.isInRecovery : false;
    const role = candidate ? candidate.role : "offline";
    const lsn = candidate ? candidate.walLsn : "lsn:0/3000000";

    const unsigned = {
      id: `rec-health-${randomUUID()}`,
      claim: {
        clusterId: this.cluster.clusterId,
        candidateStandby,
        isInRecovery,
        role,
        timeline: candidate ? candidate.timeline : 1,
      },
      evidenceClass: "POSTGRES_TELEMETRY" as const,
      source: this.config.sourceIdentifier,
      provenance: {
        tool: "pg_is_in_recovery",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [`postgres/${this.cluster.clusterId}`],
      observedAt: this.clock.now(),
      stateVersion: lsn,
      dependencies: [],
    };

    return signEvidenceReceipt(
      unsigned,
      this.config.signingKeyOrSecret,
      this.config.signingMethod,
      this.config.signerPublicKey
    );
  }

  /**
   * Probes and attests to the existence and validity of a rollback/recovery artifact.
   */
  async verifyRollbackSnapshot(): Promise<EvidenceReceipt> {
    const backup = this.cluster.getBackupArtifact();

    const unsigned = {
      id: `rec-rollback-${randomUUID()}`,
      claim: {
        clusterId: this.cluster.clusterId,
        validRollbackSnapshot: backup.valid,
        snapshotId: backup.snapshotId,
        snapshotEpochMs: backup.epochMs,
      },
      evidenceClass: "ROLLBACK_ATTESTATION" as const,
      source: "verifier.postgres.backup-service",
      provenance: {
        tool: "pg_basebackup.verify",
        runId: `run-${randomUUID().slice(0, 8)}`,
        parentReceiptIds: [],
      },
      scope: [`postgres/${this.cluster.clusterId}`],
      observedAt: this.clock.now(),
      stateVersion: "lsn:0/3000000",
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
