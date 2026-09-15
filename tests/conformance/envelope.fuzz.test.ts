import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { EnvelopeTemplate } from "@cac/schemas";
import { validateProposalAgainstTemplate } from "@cac/certificate";

describe("Execution Envelope Fuzzing & Boundary Invariants", () => {
  const baseTemplate: EnvelopeTemplate = {
    templateId: "fuzz.template.v1",
    version: "1.0.0",
    targetAction: "FailoverDatabase",
    resourceConstraints: {
      candidateStandby: {
        type: "ONE_OF",
        allowed: ["replica-01", "replica-02", "replica-03"],
      },
    },
    parameterConstraints: [
      {
        param: "maxDataLossBytes",
        type: "RANGE",
        bounds: { min: 0, max: 1000 },
      },
      {
        param: "timeoutSeconds",
        type: "RANGE",
        bounds: { min: 10, max: 60 },
      },
    ],
    intentConstraints: {
      allowedGoals: ["Emergency database failover"],
      requiredConstraints: ["zero-unreplicated-transactions"],
    },
    effectConstraints: {
      maxEstimatedDataLossBytes: 500,
    },
    coverageRequirements: [],
    guardRequirements: [],
    maxValidityDurationMs: 60000,
  };

  it("strictly admits only parameters within [min, max] ranges", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 2000 }),
        fc.integer({ min: -50, max: 150 }),
        (dataLoss, timeout) => {
          const proposal = {
            action: "FailoverDatabase",
            intent: {
              goal: "Emergency database failover",
              constraints: ["zero-unreplicated-transactions"],
            },
            scope: ["postgres/prod"],
            principal: "fuzz-agent",
            params: {
              candidateStandby: "replica-01",
              maxDataLossBytes: dataLoss,
              timeoutSeconds: timeout,
            },
            constraints: {
              maxDataLossBytes: dataLoss,
            },
          };

          const result = validateProposalAgainstTemplate(proposal, baseTemplate);

          const shouldAllow =
            dataLoss >= 0 &&
            dataLoss <= 1000 &&
            dataLoss <= 500 && // effect constraint
            timeout >= 10 &&
            timeout <= 60;

          expect(result.allowed).toBe(shouldAllow);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("handles non-finite and boundary values safely without crashing", () => {
    const edgeValues = [NaN, Infinity, -Infinity, -1, 0, 1000, 1001, Number.MAX_SAFE_INTEGER];
    for (const val of edgeValues) {
      const proposal = {
        action: "FailoverDatabase",
        intent: {
          goal: "Emergency database failover",
          constraints: ["zero-unreplicated-transactions"],
        },
        scope: ["postgres/prod"],
        principal: "fuzz-agent",
        params: {
          candidateStandby: "replica-01",
          maxDataLossBytes: val,
        },
        constraints: {},
      };

      const result = validateProposalAgainstTemplate(proposal, baseTemplate);
      if (!Number.isFinite(val) || val < 0 || val > 1000) {
        expect(result.allowed).toBe(false);
      }
    }
  });

  it("rejects invalid goals and missing required intent constraints", () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string()), (goal, constraints) => {
        const proposal = {
          action: "FailoverDatabase",
          intent: {
            goal,
            constraints,
          },
          scope: ["postgres/prod"],
          principal: "fuzz-agent",
          params: {
            candidateStandby: "replica-01",
          },
          constraints: {},
        };

        const result = validateProposalAgainstTemplate(proposal, baseTemplate);

        const goalOk = goal === "Emergency database failover";
        const constraintsOk = constraints.includes("zero-unreplicated-transactions");

        if (!goalOk || !constraintsOk) {
          expect(result.allowed).toBe(false);
        }
      }),
      { numRuns: 300 }
    );
  });
});
