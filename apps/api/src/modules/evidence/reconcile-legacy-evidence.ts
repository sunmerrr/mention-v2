import {
  classificationEvidenceSchema,
  conversationEvidenceSchema,
  evidenceBundleSchema,
} from '@app/shared';
/** Legacy detail omits its guard token; guarded options retain human/stale state. */
export function reconcileLegacyEvidence(detailValue: unknown, optionsValue: unknown) {
  const detail = conversationEvidenceSchema.parse(detailValue),
    options = classificationEvidenceSchema.array().parse(optionsValue);
  for (const option of options) {
    const evaluation = detail.conversation.evaluations[option.target];
    if (!evaluation || option.conversationId !== detail.conversation.id)
      throw Error('LEGACY_EVIDENCE_IDENTITY_MISMATCH');
    if (evaluation.summary !== option.summary) throw Error('LEGACY_EVIDENCE_SUMMARY_CHANGED');
    if (evaluation.expected !== undefined && evaluation.expected !== option.expected)
      throw Error('LEGACY_EVIDENCE_TOKEN_CHANGED');
    if (!evaluation.stale && !option.stale && evaluation.label !== option.label)
      throw Error('LEGACY_EVIDENCE_LABEL_CHANGED');
    if (evaluation.expected === undefined) {
      evaluation.expected = option.expected;
      evaluation.stale = option.stale;
      evaluation.origin = option.origin;
      if (option.stale) {
        evaluation.label = 'unreviewed';
        if (option.label !== 'unreviewed' && option.origin)
          evaluation.previous = { label: option.label, origin: option.origin };
      }
    }
  }
  return evidenceBundleSchema.parse({ detail, classifications: options });
}
