/** Institution evidence readiness, never an NHIS score or external verification. */
export type CenterEvidenceStatus = 'missing' | 'review_required' | 'unknown' | 'satisfied' | 'not_due'
export type CenterEvidenceCriterionId = '2026-homecare-24-1' | '2026-homecare-24-2' | '2026-homecare-24-3' | '2026-homecare-24-4'
export interface CenterEvidenceCriterion {
  id: CenterEvidenceCriterionId
  title: string
  summary: string
  methods: readonly string[]
  requiredChecks: readonly string[]
  sourcePages: readonly number[]
  dependsOn?: CenterEvidenceCriterionId
}
export const CENTER_EVALUATION_24_CRITERIA: readonly CenterEvidenceCriterion[] = [
  { id: '2026-homecare-24-1', title: '급여제공 결과평가', summary: '대상 기간과 신규 수급자 예외를 확인한 평가 기록이 필요합니다.', methods: ['기록', '전산'], requiredChecks: ['evaluationDate', 'assessmentSummary', 'actualAuthor', 'periodEligibility'], sourcePages: [79, 80] },
  { id: '2026-homecare-24-2', title: '평가 결과의 계획 반영', summary: '선행 결과평가와 계획 반영 또는 예외 근거를 연결합니다.', methods: ['기록', '전산'], requiredChecks: ['evaluationLink', 'followUpBasis', 'timingOrException'], sourcePages: [79, 80], dependsOn: '2026-homecare-24-1' },
  { id: '2026-homecare-24-3', title: '급여제공기록지 제공 증빙', summary: '기록 작성과 수급자·보호자에게 제공한 증빙을 구분합니다.', methods: ['기록', '전산'], requiredChecks: ['deliveryDate', 'deliveryMethod', 'recipient', 'deliveryEvidence', 'periodEligibility'], sourcePages: [79, 80, 81] },
  { id: '2026-homecare-24-4', title: '상태변화 기록', summary: '실제 관찰 내용과 작성 제공자·서명·대상 기간을 확인합니다.', methods: ['기록', '전산'], requiredChecks: ['observedState', 'actualAuthor', 'providerSignature', 'periodEligibility'], sourcePages: [79, 80] },
]
export const CENTER_EVIDENCE_CHECK_LABELS: Readonly<Record<string, string>> = {
  evaluationDate: '실제 평가일', assessmentSummary: '총평·종합소견', actualAuthor: '실제 작성자', periodEligibility: '대상 기간·적용 여부', evaluationLink: '선행 결과평가 연결', followUpBasis: '계획 반영 근거', timingOrException: '기한·예외 근거', deliveryDate: '제공일', deliveryMethod: '제공 방법', recipient: '수령인', deliveryEvidence: '제공 방식에 맞는 증빙', observedState: '실제 관찰 내용', providerSignature: '실제 제공자 서명',
}
export interface CenterEvidenceScope { organizationCode: string; personId: string; period: string; ruleVersion: string }
export interface CenterEvaluationEvidence {
  id: string
  criterionId: CenterEvidenceCriterionId
  scope: CenterEvidenceScope
  version: number
  /** Fingerprint covers the reviewed record and attachments. */
  digest: string
  origin: 'ai_draft' | 'human_record' | 'nhis'
  state: 'draft' | 'recorded'
  availability: 'active' | 'expired' | 'withdrawn'
  checks: Readonly<Record<string, 'verified' | 'missing' | 'unverified'>>
  review?: { reviewerId: string; evidenceVersion: number; digest: string; ruleVersion: string }
}
export interface CenterEvidenceInput {
  scope: CenterEvidenceScope
  criterionId: CenterEvidenceCriterionId
  ruleVerified?: boolean
  sourceState: 'loaded' | 'loading' | 'unavailable' | 'error'
  /** Verified applicability only; do not guess from document count or current week. */
  dueState: 'due' | 'future' | 'unknown'
  evidence: readonly CenterEvaluationEvidence[]
  dependencyState?: CenterEvidenceStatus
}
export interface CenterEvidenceResult { status: CenterEvidenceStatus; tone: 'danger' | 'warning' | 'neutral' | 'normal'; label: string; reasons: string[]; evidenceIds: string[] }
const presentation: Record<CenterEvidenceStatus, Pick<CenterEvidenceResult, 'tone' | 'label'>> = {
  missing: { tone: 'danger', label: '증빙 부족' }, review_required: { tone: 'warning', label: '검토 필요' }, unknown: { tone: 'neutral', label: '확인 필요' }, satisfied: { tone: 'normal', label: '증빙 확인됨' }, not_due: { tone: 'neutral', label: '미도래' },
}
function result(status: CenterEvidenceStatus, reasons: string[], evidenceIds: string[] = []): CenterEvidenceResult {
  return { status, ...presentation[status], reasons: [...new Set(reasons)], evidenceIds: [...new Set(evidenceIds)] }
}
function validScope(scope: CenterEvidenceScope) { return [scope.organizationCode, scope.personId, scope.period, scope.ruleVersion].every(value => typeof value === 'string' && Boolean(value.trim())) }
function sameScope(a: CenterEvidenceScope, b: CenterEvidenceScope) { return a.organizationCode === b.organizationCode && a.personId === b.personId && a.period === b.period && a.ruleVersion === b.ruleVersion }
const digestPattern = /^[a-f0-9]{64}$/i
export function evaluateCenterEvidence(input: CenterEvidenceInput): CenterEvidenceResult {
  const criterion = CENTER_EVALUATION_24_CRITERIA.find(row => row.id === input.criterionId)
  if (!criterion || !validScope(input.scope)) return result('unknown', ['기관·수급자·대상 기간·기준 버전을 확인해야 합니다.'])
  if (input.ruleVerified !== true) return result('unknown', ['해당 버전의 매뉴얼·개정 기준 검증이 완료되지 않았습니다.'])
  if (input.sourceState !== 'loaded') return result('unknown', [input.sourceState === 'loading' ? '기관 증빙을 조회하고 있습니다.' : '기관 증빙 저장소의 조회·연결을 확인해야 합니다.'])
  if (input.dueState === 'unknown') return result('unknown', ['대상 기간과 적용 예외가 아직 확인되지 않았습니다.'])
  if (input.dueState === 'future') return result('not_due', ['확인된 대상 기간이 아직 도래하지 않았습니다.'])
  if (criterion.dependsOn) {
    if (input.dependencyState === 'missing') return result('missing', ['선행 결과평가의 증빙이 부족하여 후속 확인을 완료할 수 없습니다.'])
    if (input.dependencyState !== 'satisfied') return result(input.dependencyState === 'review_required' ? 'review_required' : 'unknown', ['선행 결과평가의 대상·기간·근거 확인이 필요합니다.'])
  }
  // Do not expose identifiers belonging to another institution or person.
  // Resolve current versions inside the institution before matching a target.
  // A revision may move a document to a different person, period or criterion.
  const latest = new Map<string, CenterEvaluationEvidence>()
  for (const item of input.evidence.filter(item => item.scope.organizationCode === input.scope.organizationCode)) {
    const previous = latest.get(item.id)
    if (previous && previous.version === item.version && (previous.digest !== item.digest || previous.availability !== item.availability || previous.criterionId !== item.criterionId || !sameScope(previous.scope, item.scope))) return result('review_required', ['같은 증빙 버전의 내용이나 상태가 달라 최신 자료를 다시 조회해야 합니다.'])
    if (!previous || item.version >= previous.version) latest.set(item.id, item)
  }
  const matching = [...latest.values()].filter(item => item.criterionId === input.criterionId && sameScope(item.scope, input.scope))
  if (!matching.length) return result('missing', ['선택한 대상·기간·기준 버전에 맞는 증빙이 없습니다.'])
  const active = matching.filter(item => item.availability === 'active')
  if (!active.length) return result('missing', ['연결했던 증빙이 만료되었거나 철회되어 다시 확인해야 합니다.'])
  const reasons: string[] = []
  for (const item of active) {
    const itemReasons: string[] = []
    if (!item.id.trim() || !Number.isSafeInteger(item.version) || item.version < 1 || !digestPattern.test(item.digest)) itemReasons.push('증빙 식별자·버전·내용 확인번호가 유효하지 않습니다.')
    if (item.origin === 'ai_draft' || item.state !== 'recorded') itemReasons.push('AI 초안 또는 작성 중인 자료는 증빙 확인 완료가 아닙니다.')
    const outstanding = criterion.requiredChecks.filter(key => item.checks[key] !== 'verified')
    if (outstanding.length) itemReasons.push(`확인이 필요한 항목: ${outstanding.map(key => CENTER_EVIDENCE_CHECK_LABELS[key] || key).join(', ')}`)
    const review = item.review
    if (!review?.reviewerId.trim()) itemReasons.push('권한 있는 검토자의 증빙 확인이 필요합니다.')
    else if (review.evidenceVersion !== item.version || review.digest !== item.digest || review.ruleVersion !== input.scope.ruleVersion) itemReasons.push('증빙 또는 기준이 변경되어 이전 검토를 재사용할 수 없습니다.')
    if (!itemReasons.length) return result('satisfied', ['선택한 대상·기간·기준의 필수 증빙과 현재 버전 검토가 확인됐습니다. 공단의 최종 평가 판정은 아닙니다.'], [item.id])
    reasons.push(...itemReasons)
  }
  return result('review_required', reasons, active.map(item => item.id))
}
