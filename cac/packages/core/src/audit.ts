import type {
  CACVerdict,
  DischargeResult,
  RemediationContract,
  RiskVector,
} from "@cac/schemas";

export interface AuditRecord {
  admissionId: string;
  proposalDigest: string;
  principal: string;
  action: string;
  riskVector: RiskVector;
  policyEpoch: string;
  generatedObligationIds: string[];
  dischargeResults: Record<string, DischargeResult>;
  selectedWitnessIds: Record<string, string[]>;
  witnessDigest: string | null;
  guardIds: string[];
  verdict: CACVerdict["kind"];
  verdictDetails: {
    certificateId?: string;
    denialReason?: string;
    abortReason?: string;
    unresolvedCount?: number;
    approvalsCount?: number;
  };
  remediationContracts: RemediationContract[];
  timestamps: {
    evaluatedAt: string;
    recordedAt: string;
  };
}

export interface AuditLogger {
  log(record: AuditRecord): void;
  getRecords(): AuditRecord[];
  clear(): void;
}

export class MemoryAuditLogger implements AuditLogger {
  private records: AuditRecord[] = [];

  log(record: AuditRecord): void {
    // Structural clone to ensure immutability of audit records
    this.records.push(JSON.parse(JSON.stringify(record)));
  }

  getRecords(): AuditRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
  }
}
