import type {
  GenericActionProposal as ActionProposal,
  AdmissionGuard,
  AdmissionWitnessManifest,
  AssuranceObligation,
  ControllerVisibleState,
  EvidenceReceipt,
} from "@cac/schemas";

/**
 * Instantiates explicit policy guard templates into the concrete Admission Guard Set G_q.
 * Conforms to Section 4.4 and Section 19 of the CAC requirements.
 */
export function deriveGuards(
  manifest: AdmissionWitnessManifest,
  obligations: AssuranceObligation[],
  proposal: ActionProposal,
  state: ControllerVisibleState,
  _receiptsMap?: Map<string, EvidenceReceipt>
): AdmissionGuard[] {
  const guardSet: AdmissionGuard[] = [];
  const guardIds = new Set<string>();

  const obligationMap = new Map(obligations.map((o) => [o.id, o]));

  for (const entry of manifest.entries) {
    const obligation = obligationMap.get(entry.obligationId);
    if (!obligation) continue;

    for (const template of obligation.guardTemplates) {
      if (guardIds.has(template.id)) continue;
      guardIds.add(template.id);

      let expectedValue: unknown;
      let target = template.target;
      if (template.expectedValueExtractor === "params.clusterId") {
        expectedValue = proposal.params.clusterId;
      } else if (template.expectedValueExtractor === "params.candidateStandby") {
        expectedValue = proposal.params.candidateStandby;
      } else if (template.expectedValueExtractor === "literal.standby") {
        expectedValue = "standby";
      } else if (template.expectedValueExtractor === "state.replicationEpoch") {
        expectedValue = state.replicationEpoch;
      } else if (template.id === "guard-node-schedulable" && template.expectedValueExtractor === "true") {
        expectedValue = true;
        target = String((proposal.params as Record<string, unknown>)["nodeName"]);
      } else {
        throw new Error(`Unsupported guard extractor: ${template.expectedValueExtractor}`);
      }

      guardSet.push({
        id: template.id,
        target,
        predicateDescription: template.predicateDescription,
        expectedValue,
      });
    }
  }

  // Lexicographically sort guard set by guard ID for determinism
  guardSet.sort((a, b) => a.id.localeCompare(b.id));

  return guardSet;
}
