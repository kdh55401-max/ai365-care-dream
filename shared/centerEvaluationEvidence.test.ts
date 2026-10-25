import { describe, expect, it } from 'vitest'
import { CENTER_EVALUATION_24_CRITERIA, evaluateCenterEvidence, type CenterEvidenceInput, type CenterEvaluationEvidence } from './centerEvaluationEvidence.js'
const digest = 'a'.repeat(64)
function evidence(patch: Partial<CenterEvaluationEvidence> = {}): CenterEvaluationEvidence {
  return { id: 'fake-evidence', criterionId: '2026-homecare-24-4', scope: { organizationCode: 'FAKE', personId: 'fake-person', period: 'fake-week', ruleVersion: 'fake-rule-v1' }, version: 1, digest, origin: 'human_record', state: 'recorded', availability: 'active', checks: { observedState: 'verified', actualAuthor: 'verified', providerSignature: 'verified', periodEligibility: 'verified' }, review: { reviewerId: 'fake-reviewer', evidenceVersion: 1, digest, ruleVersion: 'fake-rule-v1' }, ...patch }
}
function input(patch: Partial<CenterEvidenceInput> = {}): CenterEvidenceInput {
  return { scope: evidence().scope, criterionId: '2026-homecare-24-4', ruleVerified: true, sourceState: 'loaded', dueState: 'due', evidence: [evidence()], ...patch }
}
describe('평가 증빙 경계', () => {
  it('네 기준과 전달 증빙/제공자 서명은 분리한다', () => {
    expect(new Set(CENTER_EVALUATION_24_CRITERIA.map(row => row.id)).size).toBe(4)
    expect(CENTER_EVALUATION_24_CRITERIA[2].requiredChecks).toContain('deliveryEvidence')
    expect(CENTER_EVALUATION_24_CRITERIA[3].requiredChecks).toContain('providerSignature')
  })
  it.each([undefined, false])('기준 검증 %s로 정상 표시를 만들 수 없다', ruleVerified => expect(evaluateCenterEvidence(input({ ruleVerified })).status).toBe('unknown'))
  it.each(['loading', 'unavailable', 'error'] as const)('조회 %s를 미충족으로 오판하지 않는다', sourceState => expect(evaluateCenterEvidence(input({ sourceState, evidence: [] })).status).toBe('unknown'))
  it('기간 미확인과 미도래를 분리한다', () => {
    expect(evaluateCenterEvidence(input({ dueState: 'unknown' })).status).toBe('unknown')
    expect(evaluateCenterEvidence(input({ dueState: 'future' })).status).toBe('not_due')
  })
  it('수급자를 선택하지 않으면 판정을 시작하지 않는다', () => expect(evaluateCenterEvidence(input({ scope: { ...evidence().scope, personId: '' } })).status).toBe('unknown'))
  it('도래 확인 후 증빙이 없으면 빨강과 사유다', () => expect(evaluateCenterEvidence(input({ evidence: [] }))).toMatchObject({ status: 'missing', tone: 'danger' }))
  it.each(['organizationCode', 'personId', 'period', 'ruleVersion'] as const)('%s가 다른 자료를 재사용·노출하지 않는다', key => {
    const r = evaluateCenterEvidence(input({ evidence: [evidence({ id: 'private-id', scope: { ...evidence().scope, [key]: 'other' } })] }))
    expect(r.status).toBe('missing'); expect(JSON.stringify(r)).not.toContain('private-id')
  })
  it('다른 기준의 자료는 무관하다', () => expect(evaluateCenterEvidence(input({ evidence: [evidence({ criterionId: '2026-homecare-24-3' })] })).status).toBe('missing'))
  it.each(['draft', 'recorded'] as const)('AI 초안은 %s 상태여도 정상 표시하지 않는다', state => expect(evaluateCenterEvidence(input({ evidence: [evidence({ origin: 'ai_draft', state })] })).status).toBe('review_required'))
  it('일반 작성중 자료도 확인 완료가 아니다', () => expect(evaluateCenterEvidence(input({ evidence: [evidence({ state: 'draft' })] })).status).toBe('review_required'))
  it.each(['providerSignature', 'observedState', 'actualAuthor', 'periodEligibility'])('%s 확인이 빠지면 검토가 필요하다', key => {
    const p = evidence(); expect(evaluateCenterEvidence(input({ evidence: [{ ...p, checks: { ...p.checks, [key]: 'missing' } }] })).status).toBe('review_required')
  })
  it('기록 작성만으로 제공 증빙을 대체하지 않는다', () => {
    const c = CENTER_EVALUATION_24_CRITERIA[2]
    const p = evidence({ criterionId: c.id, checks: Object.fromEntries(c.requiredChecks.map(k => [k, k === 'deliveryEvidence' ? 'missing' : 'verified'])) })
    expect(evaluateCenterEvidence(input({ criterionId: c.id, evidence: [p] })).status).toBe('review_required')
  })
  it('검토자·버전·지문·기준 변경은 재검토한다', () => {
    const old = evidence().review!
    for (const review of [undefined, { ...old, reviewerId: '' }, { ...old, evidenceVersion: 0 }, { ...old, digest: 'b'.repeat(64) }, { ...old, ruleVersion: 'old' }]) expect(evaluateCenterEvidence(input({ evidence: [evidence({ review })] })).status).toBe('review_required')
  })
  it.each(['expired', 'withdrawn'] as const)('유효 증빙이 %s되면 다시 부족하다', availability => expect(evaluateCenterEvidence(input({ evidence: [evidence({ availability })] })).status).toBe('missing'))
  it('현재 증빙과 검토가 완비되면 정상이며 공단 판정은 아니다', () => {
    const r = evaluateCenterEvidence(input()); expect(r.status).toBe('satisfied'); expect(r.reasons.join('')).toContain('공단의 최종 평가 판정은 아닙니다')
  })
  it('선행 평가 부족은 계획 자료로 덮을 수 없다', () => {
    const c = CENTER_EVALUATION_24_CRITERIA[1], p = evidence({ criterionId: c.id, checks: Object.fromEntries(c.requiredChecks.map(k => [k, 'verified' as const])) })
    const v = input({ criterionId: c.id, evidence: [p] })
    expect(evaluateCenterEvidence(v).status).toBe('unknown')
    expect(evaluateCenterEvidence({ ...v, dependencyState: 'missing' }).status).toBe('missing')
    expect(evaluateCenterEvidence({ ...v, dependencyState: 'satisfied' }).status).toBe('satisfied')
  })
  it('잘못된 버전·지문과 입력 변경을 차단한다', () => {
    for (const p of [{ version: 0 }, { version: 1.5 }, { digest: '' }]) expect(evaluateCenterEvidence(input({ evidence: [evidence(p)] })).status).toBe('review_required')
    const v = input(), before = JSON.stringify(v); evaluateCenterEvidence(v); expect(JSON.stringify(v)).toBe(before)
  })
  it('이전 확인본과 새 개정본이 함께 와도 옛 확인을 재사용하지 않는다', () => {
    const old = evidence(), revised = evidence({ version: 2, digest: 'b'.repeat(64) })
    for (const records of [[old, revised], [revised, old]]) expect(evaluateCenterEvidence(input({ evidence: records })).status).toBe('review_required')
    expect(evaluateCenterEvidence(input({ evidence: [old, evidence({ version: 2, availability: 'withdrawn' })] })).status).toBe('missing')
    expect(evaluateCenterEvidence(input({ evidence: [old, evidence({ digest: 'b'.repeat(64) })] })).status).toBe('review_required')
  })
  it.each(['personId', 'period', 'ruleVersion'] as const)('새 개정본이 %s를 바꿨으면 이전 대상에 과거 확인을 남기지 않는다', key => {
    const old = evidence(), moved = evidence({ version: 2, scope: { ...evidence().scope, [key]: 'moved-target' } })
    for (const records of [[old, moved], [moved, old]]) expect(evaluateCenterEvidence(input({ evidence: records })).status).toBe('missing')
  })
  it('새 기준으로 옮긴 개정본도 이전 기준의 확인을 무효화하고 다른기관 자료는 분리한다', () => {
    const old = evidence()
    expect(evaluateCenterEvidence(input({ evidence: [old, evidence({ version: 2, criterionId: '2026-homecare-24-3' })] })).status).toBe('missing')
    expect(evaluateCenterEvidence(input({ evidence: [old, evidence({ version: 2, scope: { ...old.scope, organizationCode: 'OTHER' } })] })).status).toBe('satisfied')
  })
})
