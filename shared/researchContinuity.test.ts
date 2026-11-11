import { describe, expect, it } from 'vitest'
import {
  applyAnswer,
  buildObserverQuestions,
  composeDraft,
  confirmDraft,
  countParticipants,
  editDraft,
  eventState,
  type DomainObservation,
} from './researchContinuity.js'

// 합성 사례 "합성-01": 3일 전 식사량 감소(당사자 진술), 오늘은 "특이사항 없음".
const PRIOR: DomainObservation[] = [
  { eventId: 'ev-meal-1', domain: 'meal', status: 'changed', observedOn: '2026-11-07', source: 'self_report' },
]
const TODAY = '2026-11-10'

describe('인수 확인 1 — 미관찰이 정상으로 바뀌지 않음', () => {
  it('"못 봄" 답은 미관찰로 저장되고 same_as_usual로 바뀌지 않는다', () => {
    const [q] = buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [] })
    const r = applyAnswer(q, { state: 'answered', status: 'not_observed', source: 'direct_observation' }, TODAY)
    expect(r.observation?.status).toBe('not_observed')
    const d = composeDraft({ today: TODAY, todayEntries: [r.observation!], prior: PRIOR, now: 't1' })
    expect(d.today.map((e) => e.status)).not.toContain('same_as_usual')
  })
})

describe('인수 확인 2 — 무응답과 미관찰이 구별되어 보존됨', () => {
  it('건너뜀은 관찰 상태를 만들지 않고, "못 봄"은 미관찰 상태를 만든다', () => {
    const [q] = buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [] })
    const skipped = applyAnswer(q, { state: 'skipped' }, TODAY)
    expect(skipped.answerState).toBe('skipped')
    expect(skipped.observation).toBeNull()
    const unseen = applyAnswer(q, { state: 'answered', status: 'not_observed' }, TODAY)
    expect(unseen.answerState).toBe('answered')
    expect(unseen.observation?.status).toBe('not_observed')
  })
  it('답했다고 했지만 상태가 없으면 무응답으로 센다', () => {
    const [q] = buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [] })
    expect(applyAnswer(q, { state: 'answered' }, TODAY).answerState).toBe('no_response')
  })
})

describe('인수 확인 3 — 과거 사실이 오늘 사실로 기록되지 않음', () => {
  it('초안은 오늘 사실과 과거 참고자료를 나누고, 과거는 오늘 목록에 들어가지 않는다', () => {
    const d = composeDraft({ today: TODAY, todayEntries: [...PRIOR], prior: PRIOR, now: 't1' })
    expect(d.today).toHaveLength(0)
    expect(d.pastReference).toHaveLength(1)
  })
  it('오늘 날짜 기록은 Observer 질문의 과거 근거가 되지 않는다', () => {
    const todayRow: DomainObservation = { eventId: 'e2', domain: 'sleep', status: 'changed', observedOn: TODAY }
    expect(buildObserverQuestions({ today: TODAY, prior: [todayRow], todayEntries: [] })).toHaveLength(0)
  })
})

describe('인수 확인 4 — 사람이 확인한 뒤에만 확정·공유', () => {
  it('확정 전에는 관리자에게 공유되지 않고, 수정하면 edited와 수정 시각이 남는다', () => {
    const d0 = composeDraft({ today: TODAY, todayEntries: [], prior: PRIOR, now: 't1' })
    expect(d0.sharedWithAdmin).toBe(false)
    const d1 = editDraft(d0, [{ eventId: 'ev-meal-1', domain: 'meal', status: 'not_observed', observedOn: TODAY }], 't2')
    expect(d1.status).toBe('edited')
    expect(d1.updatedAt).toBe('t2')
    expect(d1.sharedWithAdmin).toBe(false)
    const d2 = confirmDraft(d1, 't3')
    expect(d2.status).toBe('confirmed')
    expect(d2.sharedWithAdmin).toBe(true)
  })
  it('확정 뒤에는 수정으로 되돌릴 수 없다', () => {
    const d = confirmDraft(composeDraft({ today: TODAY, todayEntries: [], prior: [], now: 't1' }), 't2')
    expect(editDraft(d, [], 't3')).toBe(d)
  })
})

describe('인수 확인 5 — 관리자 열람만으로 조치가 끝나지 않음', () => {
  it('열람 이벤트가 있어도 요청 중이던 사건은 awaiting_followup 그대로다', () => {
    const base = [
      { type: 'reported' as const, at: 'a' },
      { type: 'confirmed' as const, at: 'b' },
      { type: 'admin_requested_followup' as const, at: 'c' },
    ]
    expect(eventState(base)).toBe('awaiting_followup')
    expect(eventState([...base, { type: 'admin_viewed', at: 'd' }])).toBe('awaiting_followup')
  })
  it('확정 전 열람은 확정 상태로 만들지 않는다', () => {
    expect(eventState([{ type: 'reported', at: 'a' }, { type: 'admin_viewed', at: 'b' }])).toBe('unconfirmed')
  })
})

describe('인수 확인 6 — 다음 방문의 확인 또는 확인 불가가 같은 사건에 연결', () => {
  const asked = [
    { type: 'reported' as const, at: 'a' },
    { type: 'confirmed' as const, at: 'b' },
    { type: 'admin_requested_followup' as const, at: 'c' },
  ]
  it('실제 관찰이 있으면 닫힌다', () => {
    expect(eventState([...asked, { type: 'followup_observed', at: 'd' }])).toBe('closed_observed')
  })
  it('확인 불가는 사유가 있어야 닫힌다', () => {
    expect(eventState([...asked, { type: 'followup_unverifiable', at: 'd' }])).toBe('awaiting_followup')
    expect(eventState([...asked, { type: 'followup_unverifiable', at: 'd', reason: '방문 시간이 식사 전' }])).toBe('closed_unverifiable')
  })
  it('요청 없이 들어온 다음 방문 관찰은 사건을 닫지 못한다', () => {
    expect(eventState([{ type: 'reported', at: 'a' }, { type: 'confirmed', at: 'b' }, { type: 'followup_observed', at: 'd' }])).toBe('confirmed')
  })
})

describe('인수 확인 7 — 같은 사용자가 여러 번 방문해도 참여자 수가 늘지 않음', () => {
  it('방문 3건, 참여자 1명', () => {
    const visits = [{ pseudonymId: 'P01' }, { pseudonymId: 'P01' }, { pseudonymId: 'P01' }]
    expect(visits).toHaveLength(3)
    expect(countParticipants(visits)).toBe(1)
  })
})

describe('Observer 질문 규칙', () => {
  it('질문은 1~3개이며 변화 > 판단 어려움 > 미관찰 순이다', () => {
    const prior: DomainObservation[] = [
      { eventId: 'a', domain: 'sleep', status: 'not_observed', observedOn: '2026-11-08' },
      { eventId: 'b', domain: 'meal', status: 'changed', observedOn: '2026-11-07' },
      { eventId: 'c', domain: 'mobility', status: 'uncertain', observedOn: '2026-11-08' },
      { eventId: 'd', domain: 'hydration', status: 'changed', observedOn: '2026-11-06' },
    ]
    const qs = buildObserverQuestions({ today: TODAY, prior, todayEntries: [] })
    expect(qs).toHaveLength(3)
    expect(qs.map((q) => q.domain)).toEqual(['meal', 'hydration', 'mobility'])
  })
  it('이미 물은 질문과 오늘 이미 다룬 영역은 반복하지 않는다', () => {
    const [q] = buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [] })
    expect(buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [], askedKeys: [q.key] })).toHaveLength(0)
    const covered: DomainObservation = { eventId: 'x', domain: 'meal', status: 'same_as_usual', observedOn: TODAY }
    expect(buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [covered] })).toHaveLength(0)
  })
  it('질문에 과거 날짜·출처가 담기고 진단·처치 표현이 없다', () => {
    const [q] = buildObserverQuestions({ today: TODAY, prior: PRIOR, todayEntries: [] })
    expect(q.refDate).toBe('2026-11-07')
    expect(q.refSource).toBe('self_report')
    expect(q.text).not.toMatch(/진단|처방|투약|복용하세요|병원에 가/)
  })
})
