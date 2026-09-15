export interface CACExecutionMetrics {
  // Latencies
  obligationResolutionMs: number;
  evidenceVerificationMs: number;
  certificateMintMs: number;
  gatewayLocalMs: number;
  guardIoMs: number;

  // Epistemic Work Loop metrics
  remediationTurns: number;
  timeToSafeResolutionMs: number;
  assuranceAcquisitionCostUsd: number;
}

export class MetricsCollector {
  private metrics: CACExecutionMetrics = {
    obligationResolutionMs: 0,
    evidenceVerificationMs: 0,
    certificateMintMs: 0,
    gatewayLocalMs: 0,
    guardIoMs: 0,
    remediationTurns: 0,
    timeToSafeResolutionMs: 0,
    assuranceAcquisitionCostUsd: 0,
  };

  recordLatency<T>(field: keyof Omit<CACExecutionMetrics, "remediationTurns" | "assuranceAcquisitionCostUsd">, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.metrics[field] += performance.now() - start;
    }
  }

  async recordLatencyAsync<T>(
    field: keyof Omit<CACExecutionMetrics, "remediationTurns" | "assuranceAcquisitionCostUsd">,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.metrics[field] += performance.now() - start;
    }
  }

  incrementTurns(): void {
    this.metrics.remediationTurns += 1;
  }

  addAcquisitionCost(costUsd: number): void {
    this.metrics.assuranceAcquisitionCostUsd += costUsd;
  }

  setSafeResolutionTime(ms: number): void {
    this.metrics.timeToSafeResolutionMs = ms;
  }

  snapshot(): CACExecutionMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      obligationResolutionMs: 0,
      evidenceVerificationMs: 0,
      certificateMintMs: 0,
      gatewayLocalMs: 0,
      guardIoMs: 0,
      remediationTurns: 0,
      timeToSafeResolutionMs: 0,
      assuranceAcquisitionCostUsd: 0,
    };
  }
}
