/** 표준화 척도 실시 — 기관이 종이 설문지로 실시한 응답을 문항 번호별로 입력하면 척도집 규칙대로만 채점한다.
 *
 * - 출처: 사회복지공동모금회 「배분사업 성과측정을 위한 척도집」(2017). 응답 보기·역문항·하위영역·절단점은 척도집 원문 그대로.
 * - 문항 원문은 앱에 넣지 않는다(원저작자 저작권 — 사용 허락 확인 전). 화면에는 문항 번호와 응답 보기만 보인다.
 * - 계산은 역문항 변환 → 총점·하위영역 합산(이용자 만족도 CSI-K만 문항 평균)과 척도집에 있는 절단점(무망감)까지다.
 *   임의의 건강점수·등급·환산·"개선/악화" 판정은 만들지 않는다.
 * - 결과는 기존 '정식 척도 결과'(기준정보)로 저장된다 — 도구명·버전·단위가 같으면 기존 값 비교(scale_value_diff)가 그대로 쓴다. */
import type { DomainKey } from './careTypes.js'
import type { SaveEntryInput } from './baseline.js'

export const SCALE_SOURCE = '공동모금회 척도집(2017)'
/** 저장되는 도구 버전 — 같은 척도의 사전·사후 값이 비교되려면 바뀌지 않아야 한다. */
export const SCALE_TOOL_VERSION = '척도집2017'
/** 앱에서 실시·채점한 결과임을 출처 메모 첫머리로 표시한다(문서에서 옮긴 값과 구분). */
export const SCALE_NOTE_MARKER = '[척도 실시]'

export type Respondent = 'self' | 'family' | 'observer'
export const RESPONDENT_LABELS: Record<Respondent, string> = {
  self: '어르신 본인 응답(읽어드림 포함)',
  family: '주부양자·보호자 응답',
  observer: '관찰 보고(요양보호사·보호자가 대신 평가)',
}

export interface ResponseOption {
  value: number
  label: string
}

export interface ScaleDef {
  id: string
  name: string
  /** 저장되는 도구명(짧게, 바꾸지 않음). */
  toolName: string
  book: [number, number]
  /** 척도집이 적은 적용대상. */
  target: string
  /** 이 척도에 맞는 응답자(첫 번째가 기본). */
  respondents: Respondent[]
  domain: DomainKey
  itemCount: number
  /** 기본 응답 보기. */
  options: ResponseOption[]
  /** 문항별로 보기가 다를 때(K-IADL 6·7·9번). */
  itemOptions?: Record<number, ResponseOption[]>
  /** 문항 짧은 이름 — 기능 영역 이름만(문항 원문 아님). */
  itemLabels?: string[]
  /** "해당사항 없음" 보기 허용(CSI-K). 채점에서 빠진다. */
  allowNotApplicable?: boolean
  reverse: number[]
  subscales?: Record<string, number[]>
  /** 척도집의 해석 문장. */
  interpretation: string
  /** 점수가 높을수록 바람직하지 않은 방향인지(변화 문구에 방향만 적고 좋아짐/나빠짐 판정은 하지 않는다). */
  higherMeans: string
  /** 척도집에 제시된 절단점(없으면 생략). */
  cutoffs?: Array<{ min: number; max: number; label: string }>
  /** 총점 대신 응답 문항 평균으로 저장(CSI-K). */
  scoreAs?: 'sum' | 'mean'
  cautions: string[]
}

const likert = (labels: string[], start = 1): ResponseOption[] => labels.map((label, i) => ({ value: start + i, label }))
const L5 = likert(['전혀 그렇지 않다', '그렇지 않다', '보통이다', '그렇다', '매우 그렇다'])
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const LEVEL3 = likert(['완전자립', '부분의존', '완전의존'])

export const SCALES: ScaleDef[] = [
  {
    id: 'S2-07', name: '한국판 단축형 노인 우울 척도', toolName: 'GDSSF-K', book: [120, 121], target: '노인', respondents: ['self'], domain: 'emotion_behavior',
    itemCount: 15, options: [{ value: 1, label: '예' }, { value: 0, label: '아니오' }], reverse: [1, 3, 4, 5, 6, 9, 10, 13, 14, 15],
    interpretation: '점수가 높을수록 우울 정도가 높음', higherMeans: '우울 정도가 높음',
    cautions: ['우울 선별 도구이며 진단이 아닙니다. 척도집에는 절단점이 없습니다.', '인지 저하가 있으면 자기보고 신뢰도가 낮습니다 — 결과 해석 시 함께 적어 두세요.'],
  },
  {
    id: 'S3-12', name: '한국형 일상생활수행능력 척도', toolName: 'K-ADL', book: [181, 183], target: '노인', respondents: ['self', 'observer'], domain: 'other',
    itemCount: 7, options: LEVEL3, reverse: [], itemLabels: ['옷 입기', '세수하기', '목욕하기', '식사하기', '이동', '화장실 사용', '대소변 조절'],
    interpretation: '총점이 높을수록 의존성이 높음 (최근 1주간 기준)', higherMeans: '의존성이 높음',
    cautions: ['3단계 응답이라 짧은 기간의 변화에는 둔감합니다.', '장기요양 인정조사 점수와 다른 도구입니다 — 섞어 쓰지 마세요.'],
  },
  {
    id: 'S3-13', name: '한국형 수단적 일상생활수행능력 척도', toolName: 'K-IADL', book: [184, 187], target: '노인', respondents: ['self', 'observer'], domain: 'other',
    itemCount: 10, options: LEVEL3, reverse: [],
    itemOptions: Object.fromEntries([6, 7, 9].map((n) => [n, likert(['완전자립', '부분의존', '부분의존(더 많이)', '완전의존'])])),
    itemLabels: ['몸단장', '집안 일', '식사 준비', '빨래하기', '근거리 외출', '교통수단 이용', '물건 사기', '금전관리', '전화사용', '약 챙겨먹기'],
    interpretation: '총점이 높을수록 의존성이 높음 (최근 1주간 기준, 6·7·9번은 4단계)', higherMeans: '의존성이 높음',
    cautions: ["'해본 적 없음'(예: 원래 하지 않던 일) 처리 규칙은 척도집에 없습니다 — 원저 확인 전에는 그런 문항이 있으면 실시하지 말고 메모로 남기세요."],
  },
  {
    id: 'S1-07', name: '생활 만족도 척도 (LSI-A)', toolName: 'LSI-A(18문항)', book: [94, 96], target: '노인', respondents: ['self'], domain: 'other',
    itemCount: 18, options: likert(['전혀 그렇지 않다', '대체로 그렇지 않다', '보통이다', '대체로 그렇다', '매우 그렇다']), reverse: [6, 7, 8, 11, 12, 13, 17, 18],
    interpretation: '점수가 높을수록 생활만족도가 높음', higherMeans: '생활만족도가 높음',
    cautions: ['노인 생활만족도(최성재)와 문항이 많이 겹칩니다 — 한 사업에서는 둘 중 하나만 쓰세요.'],
  },
  {
    id: 'S1-08', name: '노인 생활만족도 척도 (최성재)', toolName: '노인생활만족도(최성재)', book: [97, 99], target: '노인', respondents: ['self'], domain: 'other',
    itemCount: 20, options: [{ value: 0, label: '그렇지 않다' }, { value: 1, label: '모르겠다' }, { value: 2, label: '그렇다' }],
    reverse: [4, 5, 6, 11, 12, 13, 14, 18, 19, 20],
    subscales: { 과거차원: range(1, 6), 현재차원: range(7, 14), 미래차원: range(15, 20) },
    interpretation: '점수가 높을수록 지나온 인생과 현재·미래의 생활에 만족', higherMeans: '생활만족도가 높음',
    cautions: ["20번에 '그렇다'로 답했다면 점수와 별개로 기관 위기개입 절차에 따라 확인하세요."],
  },
  {
    id: 'S1-04', name: '자아통합감 척도', toolName: '자아통합감(김정순)', book: [84, 87], target: '노인', respondents: ['self'], domain: 'other',
    itemCount: 31, options: L5, reverse: [2, 4, 9, 11, 12, 13, 16, 17, 21, 22, 23, 25, 26, 27, 29, 30],
    subscales: {
      '현재 생활에 대한 만족': [1, 2, 5, 18, 22, 26, 30, 31], '지혜로운 삶': [4, 8, 10, 15, 21, 25, 28], '삶에 대한 태도': [9, 11, 13, 16, 23, 29],
      '지나온 일생에 대한 수용': [19, 20, 24], '노령에 대한 수용': [3, 6, 14, 17], '죽음에 대한 수용': [7, 12, 27],
    },
    interpretation: '점수가 높을수록 자아통합감이 높음', higherMeans: '자아통합감이 높음',
    cautions: ['역문항이 16개입니다 — 앱이 자동으로 바꿔 계산하므로 설문지에 표시된 번호 그대로 입력하세요.', "25번에 강하게 동의했다면 점수와 별개로 기관 위기개입 절차에 따라 확인하세요."],
  },
  {
    id: 'S4-22', name: '부양부담 척도', toolName: '부양부담(이혜자)', book: [263, 265], target: '노인 부양자(주부양자)', respondents: ['family'], domain: 'other',
    itemCount: 12, options: likert(['전혀 그렇지 않다', '별로 그렇지 않다', '대체로 그렇다', '매우 그렇다']), reverse: [],
    subscales: { '신체적 부담': [1, 2, 3], '사회활동 부담': [4, 5, 6], '정서적 부담': [7, 8, 9], '경제적 부담': [10, 11, 12] },
    interpretation: '총점이 높을수록 부양부담 수준이 높음', higherMeans: '부양부담이 높음',
    cautions: ['어르신이 아니라 주부양자가 응답합니다.', '총점과 함께 하위영역 4개 점수도 보고하세요(척도집 유의사항).'],
  },
  {
    id: 'S5-03', name: '사회적지지 척도 (MSPSS)', toolName: 'MSPSS(5점)', book: [276, 278], target: '빈곤층(노인 등 사용 가능)', respondents: ['self'], domain: 'other',
    itemCount: 12, options: likert(['전혀 그렇지 않다', '거의 그렇지 않다', '보통', '대체로 그렇다', '매우 그렇다']), reverse: [],
    subscales: { '가족 지지': [3, 4, 8, 11], '친구 지지': [6, 7, 9, 12], '의미 있는 타자의 지지': [1, 2, 5, 10] },
    interpretation: '점수가 높을수록 지각된 사회적 지지가 높음', higherMeans: '지각된 사회적 지지가 높음',
    cautions: ['원척도는 7점 응답이고 이 번안판은 5점입니다 — 다른 연구 점수와 직접 비교하지 마세요.'],
  },
  {
    id: 'S5-05', name: '사회참여 척도', toolName: '사회참여(김수연)', book: [282, 283], target: '노인', respondents: ['self'], domain: 'other',
    itemCount: 10, options: likert(['전혀 그렇지 않다', '거의 그렇지 않다', '보통', '대체로 그렇다', '매우 그렇다']), reverse: [],
    interpretation: '점수가 높을수록 사회참여 정도가 높음', higherMeans: '사회참여 정도가 높음',
    cautions: ['사회적 모임에 이미 참여하는 분을 전제로 한 문항입니다 — 모임 참여가 없는 분에게는 다른 척도를 쓰세요.'],
  },
  {
    id: 'S2-05', name: '한국어판 Beck의 무망감 척도', toolName: 'BHS-K', book: [112, 114], target: '성인(노인 외래환자도 가능)', respondents: ['self'], domain: 'emotion_behavior',
    itemCount: 20, options: [{ value: 0, label: '예' }, { value: 1, label: '아니오' }], reverse: [2, 4, 7, 9, 11, 12, 14, 16, 17, 18, 20],
    interpretation: '점수가 높을수록 무망감이 높음', higherMeans: '무망감이 높음',
    cutoffs: [{ min: 0, max: 3, label: '정상범위' }, { min: 4, max: 8, label: '경도 무망감' }, { min: 9, max: 14, label: '중등도 무망감' }, { min: 15, max: 20, label: '중도 무망감' }],
    cautions: ['구간은 척도집에 제시된 기준입니다. 중등도 이상이면 점수와 별개로 기관 위기개입 절차에 따라 확인하세요.'],
  },
  {
    id: 'S7-04', name: '성공적 노화 척도', toolName: 'KESAS', book: [385, 387], target: '노인', respondents: ['self'], domain: 'other',
    itemCount: 31, options: likert(['전혀 아니다', '거의 아니다', '보통이다', '조금 그렇다', '매우 그렇다']), reverse: [],
    subscales: { '자율적인 삶': range(1, 9), 자기완성지향: range(10, 15), '적극적 인생참여': range(16, 20), '자녀에 대한 만족': range(21, 25), 자기수용: [26, 27, 28], 타인수용: [29, 30, 31] },
    interpretation: '점수가 높을수록 성공적 노화 수준이 높음', higherMeans: '성공적 노화 수준이 높음',
    cautions: ['자녀 관련 문항(21~25번)에 답하기 어려운 분에게는 쓰지 마세요(척도집 지침상 문항 임의 삭제 금지).'],
  },
  {
    id: 'S7-08', name: '노인 학대 척도', toolName: 'CMT(노인학대)', book: [397, 398], target: '성인(노인 부양자)', respondents: ['family'], domain: 'other',
    itemCount: 10, options: likert(['전혀 그렇지 않다', '가끔 사용한다', '자주 사용한다', '항상 그렇다']), reverse: [],
    interpretation: '점수가 높을수록 학대의 정도가 심함', higherMeans: '학대 정도가 심함',
    cautions: ['부양자 자기보고라 낮은 점수가 학대 없음을 뜻하지 않습니다.', '학대가 의심되면 점수와 별개로 기관 절차와 신고의무(노인복지법)를 따르세요.'],
  },
  {
    id: 'S7-16', name: '사회복지서비스 이용자 만족도 척도', toolName: 'CSI-K', book: [418, 420], target: '종합사회복지관 이용자', respondents: ['self', 'family'], domain: 'other',
    itemCount: 20, options: likert(['전혀 그렇지 않다', '많이 그렇지 않다', '약간 그렇지 않다', '보통이다', '조금 그렇다', '대체로 그렇다', '매우 그렇다']),
    allowNotApplicable: true, reverse: [], scoreAs: 'mean',
    subscales: { '서비스 공급자에 대한 만족': range(1, 13), '서비스 결과에 대한 만족': range(14, 20) },
    interpretation: '점수가 높을수록 이용자 만족도가 높음 (해당사항 없음은 빼고 문항 평균 1~7)', higherMeans: '이용자 만족도가 높음',
    cautions: ['만족도는 과정 지표입니다 — 이용자 변화(성과)를 보여주는 척도와 함께 쓰세요.', '담당 요양보호사가 아닌 사람이 받거나 익명으로 받아야 응답이 덜 치우칩니다.'],
  },
]

export function getScale(id: string): ScaleDef | undefined {
  return SCALES.find((s) => s.id === id)
}

export function scaleForTool(toolName: string | null | undefined): ScaleDef | undefined {
  return toolName ? SCALES.find((s) => s.toolName === toolName) : undefined
}

export function optionsFor(def: ScaleDef, item: number): ResponseOption[] {
  return def.itemOptions?.[item] ?? def.options
}

/** 한 문항의 응답: 보기 값, 'NA'(해당사항 없음), null(미입력). */
export type ItemResponse = number | 'NA' | null

export interface ScaleScore {
  /** 저장할 값 — 합산(대부분) 또는 문항 평균(CSI-K). */
  value: number
  total: number
  answered: number
  notApplicable: number
  /** 이 값이 가질 수 있는 범위. */
  min: number
  max: number
  subscales: Array<{ name: string; value: number; min: number; max: number; answered: number }>
  cutoff: string | null
}

export class ScaleInputError extends Error {}

function itemRange(def: ScaleDef, item: number): { lo: number; hi: number } {
  const vals = optionsFor(def, item).map((o) => o.value)
  return { lo: Math.min(...vals), hi: Math.max(...vals) }
}

/** 역문항을 바꾼 채점용 값(척도집 규칙: 최소+최대−응답). */
export function scoredValue(def: ScaleDef, item: number, raw: number): number {
  if (!def.reverse.includes(item)) return raw
  const { lo, hi } = itemRange(def, item)
  return lo + hi - raw
}

/** 빠진 문항·보기 밖 값을 확인한다. 하나라도 빠지면 채점하지 않는다(부분 채점·결측 대체 없음). */
export function missingItems(def: ScaleDef, responses: ItemResponse[]): number[] {
  return range(1, def.itemCount).filter((n) => responses[n - 1] === null || responses[n - 1] === undefined)
}

export function scoreScale(def: ScaleDef, responses: ItemResponse[]): ScaleScore {
  if (responses.length !== def.itemCount) throw new ScaleInputError(`문항 수가 맞지 않습니다(${def.itemCount}문항).`)
  const missing = missingItems(def, responses)
  if (missing.length) throw new ScaleInputError(`응답하지 않은 문항이 있습니다: ${missing.join(', ')}번 — 모든 문항에 응답해야 채점합니다.`)
  const scored = new Map<number, number>()
  let notApplicable = 0
  responses.forEach((r, i) => {
    const n = i + 1
    if (r === 'NA') {
      if (!def.allowNotApplicable) throw new ScaleInputError(`${n}번: 이 척도에는 '해당사항 없음' 보기가 없습니다.`)
      notApplicable++
      return
    }
    if (!optionsFor(def, n).some((o) => o.value === r)) throw new ScaleInputError(`${n}번: 보기에 없는 값입니다.`)
    scored.set(n, scoredValue(def, n, r as number))
  })
  if (scored.size === 0) throw new ScaleInputError('채점할 응답이 없습니다(모두 해당사항 없음).')
  const mean = def.scoreAs === 'mean'
  const summarize = (items: number[]) => {
    const vals = items.filter((n) => scored.has(n)).map((n) => scored.get(n)!)
    const lo = items.reduce((s, n) => s + itemRange(def, n).lo, 0)
    const hi = items.reduce((s, n) => s + itemRange(def, n).hi, 0)
    const sum = vals.reduce((s, v) => s + v, 0)
    if (mean) {
      const { lo: l, hi: h } = itemRange(def, items[0])
      return { value: vals.length ? round2(sum / vals.length) : NaN, min: l, max: h, answered: vals.length, sum }
    }
    return { value: sum, min: lo, max: hi, answered: vals.length, sum }
  }
  const all = summarize(range(1, def.itemCount))
  const cutoff = def.cutoffs?.find((c) => all.value >= c.min && all.value <= c.max)?.label ?? null
  return {
    value: all.value,
    total: all.sum,
    answered: all.answered,
    notApplicable,
    min: all.min,
    max: all.max,
    subscales: Object.entries(def.subscales ?? {}).map(([name, items]) => {
      const s = summarize(items)
      return { name, value: s.value, min: s.min, max: s.max, answered: s.answered }
    }),
    cutoff,
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function unitOf(def: ScaleDef): string {
  return def.scoreAs === 'mean' ? '점(문항평균)' : '점'
}

// ── 저장 형식(기존 '정식 척도 결과' 기준정보) ──────────────────────────
export function encodeResponses(responses: ItemResponse[]): string {
  return responses.map((r) => (r === 'NA' ? 'X' : r === null ? '?' : String(r))).join(',')
}

export function decodeResponses(text: string): ItemResponse[] {
  return text.split(',').map((t) => (t === 'X' ? 'NA' : t === '?' ? null : Number(t)))
}

export function scoreSummary(def: ScaleDef, score: ScaleScore): string {
  const head = def.scoreAs === 'mean'
    ? `문항 평균 ${score.value}점(${score.min}~${score.max}) · 응답 ${score.answered}문항, 해당없음 ${score.notApplicable}문항`
    : `총점 ${score.value}점(${score.min}~${score.max})`
  const subs = score.subscales.map((s) => `${s.name} ${Number.isNaN(s.value) ? '응답 없음' : s.value}/${s.max}`).join(' · ')
  return [head, score.cutoff && `척도집 구간: ${score.cutoff}`, subs && `하위영역: ${subs}`].filter(Boolean).join(' · ')
}

export interface ScaleAdministration {
  def: ScaleDef
  responses: ItemResponse[]
  measuredOn: string
  respondent: Respondent
  memo?: string | null
}

export function buildScaleEntry(a: ScaleAdministration, base: { recipientCode: string; enteredByLabel?: string | null; requestId: string }): SaveEntryInput {
  const score = scoreScale(a.def, a.responses)
  const memo = (a.memo ?? '').trim().slice(0, 120)
  const sourceNote = [
    SCALE_NOTE_MARKER,
    `앱 채점(${SCALE_SOURCE} 규칙, ${a.def.id})`,
    `응답자: ${RESPONDENT_LABELS[a.respondent]}`,
    `응답: ${encodeResponses(a.responses)}`,
    memo && `메모: ${memo}`,
  ].filter(Boolean).join(' · ')
  return {
    recipientCode: base.recipientCode,
    kind: 'scale_result',
    domain: a.def.domain,
    statement: `${a.def.name} — ${scoreSummary(a.def, score)} · 해석: ${a.def.interpretation}`,
    valueNumeric: score.value,
    unit: unitOf(a.def),
    toolName: a.def.toolName,
    toolVersion: SCALE_TOOL_VERSION,
    referenceDate: a.measuredOn,
    sourceType: 'admin_input',
    sourceNote,
    enteredByLabel: base.enteredByLabel ?? null,
    requestId: base.requestId,
  }
}

/** 앱에서 실시한 척도 결과의 출처 메모를 읽는다(문서에서 옮긴 값이면 null). */
export function parseScaleNote(note: string | null | undefined): { scaleId: string | null; respondent: string | null; responses: ItemResponse[] | null; memo: string | null } | null {
  if (!note || !note.startsWith(SCALE_NOTE_MARKER)) return null
  const part = (label: string) => note.split(' · ').find((p) => p.startsWith(label))?.slice(label.length) ?? null
  const scaleId = /규칙, (S\d-\d{2})\)/.exec(note)?.[1] ?? null
  const resp = part('응답: ')
  return { scaleId, respondent: part('응답자: '), responses: resp ? decodeResponses(resp) : null, memo: part('메모: ') }
}

/** 같은 도구의 결과를 측정일 순으로(사전 → 사후). 같은 날 값이 여러 개면 모두 남긴다(덮어쓰지 않음). */
export interface ScaleTrendPoint {
  entryId: string
  date: string
  value: number
  confirmed: boolean
}

export function describeChange(def: ScaleDef | undefined, first: number, last: number, unit: string): string {
  const diff = round2(last - first)
  if (diff === 0) return `첫 측정과 같은 값(${last}${unit})`
  const dir = diff > 0 ? '높아짐' : '낮아짐'
  return `첫 측정 ${first} → 최근 ${last}${unit} (${diff > 0 ? '+' : ''}${diff}, 점수 ${dir}${def ? ` — 이 척도는 점수가 높을수록 ${def.higherMeans}` : ''})`
}
