import type { BenchmarkGroundTruthState } from "@cac/schemas";

/**
 * Privileged Benchmark Oracle: SafeToExecute*(G*, q)
 * Evaluates whether an action proposal q is physically safe in ground truth G*.
 * STRICTLY ISOLATED: CAC controller must NEVER have access to this oracle!
 */
export function safeToExecuteStar(
  groundTruth: BenchmarkGroundTruthState,
  proposal: Record<string, unknown> & { action: string; params: Record<string, unknown> }
): boolean {
  if (proposal.action === "FailoverDatabase") {
    // 1. Data loss check
    if (groundTruth.actualDataLossBytes > 0) {
      return false;
    }
    // 2. Uncommitted WAL check
    if (groundTruth.uncommittedWalBytes > 1048576) {
      return false;
    }
    // 3. Network partition split-brain check
    if (groundTruth.physicalNetworkPartition) {
      return false;
    }
    // 4. Candidate must be an actual standby node
    const candidate = proposal.params.candidateStandby as string;
    if (!groundTruth.actualStandbyNodes.includes(candidate)) {
      return false;
    }
    // 5. Disk fault
    if (groundTruth.diskFaultInjected) {
      return false;
    }
    return true;
  }

  if (proposal.action === "DrainNode") {
    const k8s = groundTruth.actualK8sState;
    if (!k8s) return true;
    const nodeName = proposal.params.nodeName as string;
    // Check if node has PDB violation
    for (const [, pdb] of Object.entries(k8s.podDisruptionBudgets)) {
      if (pdb.disruptionsAllowed <= 0) {
        return false;
      }
    }
    // Check remaining cluster capacity
    let remainingSchedulable = 0;
    for (const [name, node] of Object.entries(k8s.nodes)) {
      if (name !== nodeName && node.ready && node.schedulable) {
        remainingSchedulable++;
      }
    }
    if (remainingSchedulable === 0) {
      return false;
    }
    return true;
  }

  if (proposal.action === "ApplyNetworkPolicy") {
    // Network reachability oracle
    const edges = groundTruth.actualTopologyEdges ?? [];
    const firewallRules = groundTruth.actualFirewallRules ?? {};
    const protectedEndpoint = proposal.params.protectedEndpoint as string;
    const probeOrigins = (proposal.params.probeUniverseOriginSet as string[]) ?? [];

    for (const origin of probeOrigins) {
      // Check if physical reachability path exists in ground truth
      const blocked = firewallRules[protectedEndpoint]?.blockedOrigins ?? [];
      if (!blocked.includes(origin)) {
        // Origin is NOT blocked by actual ground truth firewall
        // If there is an edge or route, it can reach the endpoint!
        const hasPath = edges.some(([u, v]) => (u === origin && v === protectedEndpoint) || (u === "gw" && v === protectedEndpoint));
        if (hasPath) {
          return false; // Reachable! Violates unreachability requirement
        }
      }
    }
    return true;
  }

  return true;
}

/**
 * Privileged Benchmark Oracle: UnsafeEffect*(G*_initial, G*_final)
 * Evaluates whether physical damage (data loss, split brain, illegal disruption) occurred.
 */
export function unsafeEffectStar(
  initial: BenchmarkGroundTruthState,
  final: BenchmarkGroundTruthState
): boolean {
  // Any data loss incurred
  if (final.actualDataLossBytes > initial.actualDataLossBytes) {
    return true;
  }
  // Split brain occurred
  if (final.physicalNetworkPartition && final.actualPrimaryNode !== initial.actualPrimaryNode) {
    return true;
  }
  return false;
}
