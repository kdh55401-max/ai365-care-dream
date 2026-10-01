import { describe, expect, it } from 'vitest'
import { planSaveEntry } from './baseline.js'
import {
  buildScaleEntry,
  decodeResponses,
  encodeResponses,
  getScale,
  parseScaleNote,
  SCALES,
  SCALE_TOOL_VERSION,
  scoreScale,
  type ItemResponse,
  type ScaleDef,
} from './scales.js'

const def = (id: string): ScaleDef => getScale(id)!
const fill = (d: ScaleDef, v: ItemResponse) => Array.from({ length: d.itemCount }, () => v)
const ctx = { organizationId: 'org1', now: '2026-10-01T00:00:00.000Z', newId: (() => { let i = 0; return () => `id-${++i}` })() }

describe('척도 정의(척도집 원문과 일치)', () => {
  it('13개 척도, 하위영역 문항은 1~N을 빠짐·겹침 없이 덮는다', () => {
    expect(SCALES).toHaveLength(13)
    for (const s of SCALES) {
      if (s.subscales) expect(Object.values(s.subscales).flat().sort((a, b) => a - b)).toEqual(Array.from({ length: s.itemCount }, (_, i) => i + 1))
      for (const r of s.reverse) expect(r).toBeLessThanOrEqual(s.itemCount)
      if (s.itemLabels) expect(s.itemLabels).toHaveLength(s.itemCount)
    }
    expect(new Set(SCALES.map((s) => s.toolName)).size).toBe(SCALES.length)
  })
})

describe('채점', () => {
  it('GDSSF-K: 예=1, 역문항(1,3,4,5,6,9,10,13,14,15)은 0↔1 — 모두 "예"면 우울 방향 5점', () => {
    const d = def('S2-07')
    expect(scoreScale(d, fill(d, 1)).value).toBe(5) // 정문항 2,7,8,11,12만 1점
    expect(scoreScale(d, fill(d, 0)).value).toBe(10)
    expect(scoreScale(d, fill(d, 0))).toMatchObject({ min: 0, max: 15 })
  })

  it('BHS-K: 예=0, 아니오=1, 부정문항 역산 → 무망감 방향 응답이 1점이고 척도집 구간을 붙인다', () => {
    const d = def('S2-05')
    // 무망감 방향: 긍정문항(1,3,5,6,8,10,13,15,19)에 아니오(1), 부정문항에 예(0→역산 1)
    const hopeless = Array.from({ length: 20 }, (_, i) => (d.reverse.includes(i + 1) ? 0 : 1))
    expect(scoreScale(d, hopeless)).toMatchObject({ value: 20, cutoff: '중도 무망감' })
    const hopeful = hopeless.map((v) => 1 - v)
    expect(scoreScale(d, hopeful)).toMatchObject({ value: 0, cutoff: '정상범위' })
    const nine = hopeful.map((v, i) => (i < 9 ? 1 - v : v))
    expect(scoreScale(d, nine).cutoff).toBe('중등도 무망감')
    expect(scoreScale(d, hopeful.map((v, i) => (i < 4 ? 1 - v : v))).cutoff).toBe('경도 무망감')
  })

  it('K-IADL: 6·7·9번만 4단계 — 범위 10~33, 3단계 문항에 4를 넣으면 거부', () => {
    const d = def('S3-13')
    const worst = Array.from({ length: 10 }, (_, i) => ([6, 7, 9].includes(i + 1) ? 4 : 3))
    expect(scoreScale(d, worst)).toMatchObject({ value: 33, min: 10, max: 33 })
    expect(() => scoreScale(d, fill(d, 4))).toThrow(/1번: 보기에 없는 값/)
  })

  it('노인 생활만족도: 0~2점, 역문항 0↔2, 하위영역 과거·현재·미래 합', () => {
    const d = def('S1-08')
    const s = scoreScale(d, fill(d, 2))
    expect(s.value).toBe(20) // 정문항 10개만 2점
    expect(s.subscales.map((x) => [x.name, x.value, x.max])).toEqual([['과거차원', 6, 12], ['현재차원', 8, 16], ['미래차원', 6, 12]])
  })

  it('자아통합감: 5점 역문항 1↔5, 2↔4 · 3은 그대로', () => {
    const d = def('S1-04')
    expect(scoreScale(d, fill(d, 5)).value).toBe(15 * 5 + 16 * 1)
    expect(scoreScale(d, fill(d, 3)).value).toBe(93)
  })

  it('부양부담: 역문항 없음, 하위영역 4개 · 범위 12~48', () => {
    const d = def('S4-22')
    const r = [1, 1, 1, 4, 4, 4, 2, 2, 2, 3, 3, 3]
    const s = scoreScale(d, r)
    expect(s).toMatchObject({ value: 30, min: 12, max: 48 })
    expect(s.subscales.map((x) => x.value)).toEqual([3, 12, 6, 9])
  })

  it("CSI-K: '해당사항 없음'은 빼고 문항 평균(1~7)", () => {
    const d = def('S7-16')
    const r: ItemResponse[] = fill(d, 7)
    r[0] = 'NA'
    r[1] = 4
    const s = scoreScale(d, r)
    expect(s).toMatchObject({ value: 6.84, answered: 19, notApplicable: 1, min: 1, max: 7 })
    expect(() => scoreScale(d, fill(d, 'NA'))).toThrow(/모두 해당사항 없음/)
    expect(() => scoreScale(def('S2-07'), [...fill(def('S2-07'), 1).slice(1), 'NA'])).toThrow(/해당사항 없음/)
  })

  it('빠진 문항이 있으면 채점하지 않는다(결측 대체 없음)', () => {
    const d = def('S5-03')
    const r = fill(d, 3)
    r[4] = null
    r[10] = null
    expect(() => scoreScale(d, r)).toThrow('응답하지 않은 문항이 있습니다: 5, 11번')
  })
})

describe('저장 형식 — 기존 정식 척도 결과 규칙을 그대로 통과', () => {
  it('도구명·버전·값·단위·측정일·출처가 모두 채워지고 출처 메모에서 응답을 되살릴 수 있다', () => {
    const d = def('S4-22')
    const responses = [1, 1, 1, 4, 4, 4, 2, 2, 2, 3, 3, 3]
    const input = buildScaleEntry({ def: d, responses, measuredOn: '2026-09-30', respondent: 'family', memo: '사전 측정' }, { recipientCode: 'a01', requestId: 'req-12345678' })
    const entry = planSaveEntry(input, { document: null, lineage: [] }, ctx)
    expect(entry).toMatchObject({ kind: 'scale_result', tool_name: '부양부담(이혜자)', tool_version: SCALE_TOOL_VERSION, value_numeric: 30, unit: '점', reference_date: '2026-09-30', recipient_code: 'A01', status: 'draft' })
    expect(entry.statement).toContain('신체적 부담 3/12')
    const parsed = parseScaleNote(entry.source_note)
    expect(parsed).toMatchObject({ scaleId: 'S4-22', memo: '사전 측정' })
    expect(parsed?.responses).toEqual(responses)
    expect(entry.source_note!.length).toBeLessThanOrEqual(500)
  })

  it('가장 긴 척도(31문항)도 출처 메모 500자 안에 들어간다', () => {
    for (const d of SCALES) {
      const input = buildScaleEntry({ def: d, responses: fill(d, d.options[0].value), measuredOn: '2026-09-30', respondent: d.respondents[0], memo: 'x'.repeat(200) }, { recipientCode: 'A01', requestId: 'req-12345678' })
      expect(input.sourceNote!.length).toBeLessThanOrEqual(500)
    }
  })

  it('응답 문자열 왕복', () => {
    const r: ItemResponse[] = [1, 'NA', 7]
    expect(decodeResponses(encodeResponses(r))).toEqual(r)
    expect(parseScaleNote('2026 공단 평가표')).toBeNull()
  })
})
