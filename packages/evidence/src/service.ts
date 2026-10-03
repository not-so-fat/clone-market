import type { AdoptionEvidenceQuery } from "./types.js";
import type { EvidenceStore } from "./types.js";
import { deriveAdoptionSnapshot, type ClassifierOptions } from "./classifier.js";

export class EvidenceService {
  constructor(private readonly repository: EvidenceStore) {}

  async derive(templateId: string, options: ClassifierOptions): Promise<AdoptionEvidenceQuery> {
    const evidence = await this.repository.listEvidence(templateId);
    const derivation = deriveAdoptionSnapshot(templateId, evidence, options);
    await this.repository.saveDerivation(derivation);
    return { ...derivation, evidence };
  }

  async getLatest(templateId: string): Promise<AdoptionEvidenceQuery | undefined> {
    const derivation = await this.repository.getLatestDerivation(templateId);
    if (derivation === undefined) return undefined;
    return { ...derivation, evidence: await this.repository.listEvidence(templateId) };
  }
}
