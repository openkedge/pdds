import type { ActionProposal, AdmissionCertificate, ControllerVisibleState, Instant } from "@cac/schemas";
import type { LiveAuthorizer } from "@cac/policy";
import type { CapabilityStore } from "./capabilityStore.js";
import { admissionValid } from "./validation.js";

export interface ExecutionResult {
  outcome: "SUCCESS" | "FAILED" | "AMBIGUOUS";
  details?: Record<string, unknown>;
  error?: string;
}

export interface TargetExecutionAdapter {
  execute(action: string, params: Record<string, unknown>): Promise<ExecutionResult>;
}

export type DispatchResponse =
  | { status: "EXECUTED"; result: ExecutionResult }
  | { status: "REJECTED"; reason: string }
  | { status: "AMBIGUOUS_OUTCOME"; reason: string; details?: Record<string, unknown> | undefined };

export interface AuthorizedDispatchParams {
  certificate: AdmissionCertificate;
  invocationProposal: ActionProposal | (Record<string, unknown> & { action: string; params: Record<string, unknown>; intent: { goal: string; constraints: string[] }; scope: string[]; principal: string });
  requester: string;
  liveState: ControllerVisibleState;
  livePolicyEpoch: string;
  liveAuthorizer: LiveAuthorizer;
  capabilityStore: CapabilityStore;
  targetAdapter: TargetExecutionAdapter;
  controllerPublicKeyPem: string;
  currentTime: Instant;
  revocationList?: Set<string> | undefined;
  skipGuards?: boolean | undefined;
}

/**
 * Two-stage atomic authorized execution dispatch.
 * 1. Side-effect-free admission validation.
 * 2. Atomic CAS capability consumption (UNUSED -> CONSUMED).
 * 3. Forward to downstream execution adapter.
 * Handles downstream ambiguities without retrying or reusing capability.
 * Conforms to Section 4.4, Equation (295) and Section 25 of the CAC requirements.
 */
export async function authorizedDispatch(
  params: AuthorizedDispatchParams
): Promise<DispatchResponse> {
  const {
    certificate,
    invocationProposal,
    requester,
    liveState,
    livePolicyEpoch,
    liveAuthorizer,
    capabilityStore,
    targetAdapter,
    controllerPublicKeyPem,
    currentTime,
    revocationList,
    skipGuards,
  } = params;

  // Stage 1: Pure Semantic Validation (does NOT consume nonce)
  const validation = await admissionValid({
    certificate,
    invocationProposal,
    requester,
    liveState,
    livePolicyEpoch,
    liveAuthorizer,
    capabilityStore,
    controllerPublicKeyPem,
    currentTime,
    revocationList,
    skipGuards,
  });

  if (!validation.valid) {
    return {
      status: "REJECTED",
      reason: validation.reason ?? "Admission validation failed",
    };
  }

  // Stage 2: Atomic Capability Consumption (Single-dispatch linearizable CAS)
  const consumed = await capabilityStore.consumeOnce(certificate.nonce);
  if (!consumed) {
    return {
      status: "REJECTED",
      reason: `Replay rejection: single-use capability nonce '${certificate.nonce}' was already consumed`,
    };
  }

  // Capability is burned. Forward request to target execution adapter.
  try {
    const execResult = await targetAdapter.execute(
      invocationProposal.action,
      invocationProposal.params
    );

    if (execResult.outcome === "AMBIGUOUS") {
      // Downstream execution returned ambiguous outcome (timeout / dropped connection)
      // DO NOT retry or restore nonce.
      return {
        status: "AMBIGUOUS_OUTCOME",
        reason: execResult.error ?? "Downstream execution returned ambiguous state (F10)",
        details: execResult.details,
      };
    }

    return {
      status: "EXECUTED",
      result: execResult,
    };
  } catch (err: unknown) {
    // Unhandled adapter exception treated as ambiguous outcome
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: "AMBIGUOUS_OUTCOME",
      reason: `Target adapter exception after capability consumption: ${errorMsg}`,
    };
  }
}
