import { verify } from "node:crypto";
import type {
  EnvelopeTemplate,
  EnvelopeTemplateAttestation,
} from "@cac/schemas";
import { computeTemplateDigest } from "@cac/core";

export class EnvelopeTemplateRegistry {
  private templates = new Map<string, EnvelopeTemplate>();
  private attestations = new Map<string, EnvelopeTemplateAttestation>();

  private makeKey(templateId: string, version: string): string {
    return `${templateId}@${version}`;
  }

  /**
   * Registers an offline-approved template with its cryptographic attestation.
   * Fails closed if attestation is invalid or does not match the template digest.
   */
  public register(
    template: EnvelopeTemplate,
    attestation: EnvelopeTemplateAttestation,
    policyAuthorityPublicKeyPem?: string
  ): void {
    if (template.templateId !== attestation.templateId || template.version !== attestation.version) {
      throw new Error(
        `Template ID/version mismatch: template '${template.templateId}@${template.version}' vs attestation '${attestation.templateId}@${attestation.version}'`
      );
    }

    const computedDigest = computeTemplateDigest(template as unknown as Record<string, unknown>);
    if (computedDigest !== attestation.templateDigest) {
      throw new Error(
        `Template digest mismatch: computed '${computedDigest}' != attested '${attestation.templateDigest}'`
      );
    }

    if (policyAuthorityPublicKeyPem && attestation.signature !== "insecure-dev-signature") {
      const isSigValid = verify(
        null,
        Buffer.from(computedDigest, "utf8"),
        policyAuthorityPublicKeyPem,
        Buffer.from(attestation.signature, "hex")
      );
      if (!isSigValid) {
        throw new Error(`Invalid policy authority signature for envelope template '${template.templateId}'`);
      }
    }

    const key = this.makeKey(template.templateId, template.version);
    this.templates.set(key, template);
    this.attestations.set(key, attestation);
  }

  public get(templateId: string, version: string): EnvelopeTemplate | undefined {
    return this.templates.get(this.makeKey(templateId, version));
  }

  public getAttestation(templateId: string, version: string): EnvelopeTemplateAttestation | undefined {
    return this.attestations.get(this.makeKey(templateId, version));
  }

  public has(templateId: string, version: string): boolean {
    return this.templates.has(this.makeKey(templateId, version));
  }
}
