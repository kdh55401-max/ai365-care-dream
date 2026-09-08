import { computeInformativeness, type CareReportRecord, type DomainEntry, type StructuredReport } from './careTypes.js'

export interface Fraction {
  numerator: number
  denominator: number
  percent: number | null // null이면 분모 0 (표본 없음)
}

export function fraction(numerator: number, denominator: number): Fraction {
  return {
    numerator,
    denominator,
    percent: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null,
  }
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function average(nums: number[]): number | null {
  if (nums.length === 0) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 공백 차이만으로 "수정함"으로 잘못 집계되지 않도록 각 필드를 정규화한다.
 * 의미 유사도 판정(AI 비교)은 이번 범위에서 제외하고, 텍스트 정규화 비교만 한다. */
function normalizeReportField(v: string | undefined | null): string {
  return (v ?? '').trim().replace(/\s+/g, ' ')
}

function reportTextEquivalent(a: StructuredReport | null, b: StructuredReport | null): boolean {
  const fields: Array<keyof StructuredReport> = ['change', 'action', 'result', 'escalation']
  return fields.every((f) => normalizeReportField(a?.[f]) === normalizeReportField(b?.[f]))
}

const PARTICIPANT_CODES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09']

/** "AI 적용 전" 정보충실도(0~4)의 자동 근사값. 원문은 4개 항목으로 구조화돼 있지
 * 않으므로, 각 영역을 시사하는 표현이 원문에 있는지로 근사한다. 실제 관찰
 * 서술이 있으면 change는 항상 충족으로 본다(모든 보고는 최소한 관찰 서술에서
 * 출발하기 때문). 정확한 판정이 아니라 "AI가 구조화해 주기 전에도 이 정보가
 * 이미 원문에 있었는가"를 보여주기 위한 참고 지표임을 화면에 함께 표시한다. */
const ACTION_HINTS = ['부축', '연락', '전화', '조치', '119', '앉혔', '눕혔', '확인함', '병원', '휴식']
const RESULT_HINTS = ['현재', '지금', '계속', '호전', '진정', '쉬고', '괜찮아', '그대로', '유지']
const ESCALATION_HINTS = ['센터', '보고', '확인 필요', '연락 예정', '다음 방문', '추가 확인']

export function computeRawInformativeness(rawInput: string): number {
  const text = rawInput ?? ''
  let score = text.trim().length > 0 ? 1 : 0 // change: 관찰 서술 자체
  if (ACTION_HINTS.some((k) => text.includes(k))) score += 1
  if (RESULT_HINTS.some((k) => text.includes(k))) score += 1
  if (ESCALATION_HINTS.some((k) => text.includes(k))) score += 1
  return score
}

export interface ParticipationCell {
  date: string
  dailySubmitted: boolean
  additionalCount: number
}

export interface ParticipationRow {
  participantCode: string
  cells: ParticipationCell[]
  totalSubmitted: number
}

export function buildParticipationGrid(reports: CareReportRecord[], dates: string[]): ParticipationRow[] {
  const submitted = reports.filter((r) => r.status === 'submitted' && r.report_source !== 'scenario')
  return PARTICIPANT_CODES.map((code) => {
    const own = submitted.filter((r) => r.participant_code === code)
    const cells = dates.map((date) => {
      const onDate = own.filter((r) => r.report_date === date)
      return {
        date,
        dailySubmitted: onDate.some((r) => r.report_type === 'daily'),
        additionalCount: onDate.filter((r) => r.report_type === 'additional').length,
      }
    })
    return { participantCode: code, cells, totalSubmitted: own.length }
  })
}

export function pilotDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const cur = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (cur.getTime() <= end.getTime()) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

export interface CumulativePoint {
  date: string
  dailyCumulative: number
  additionalCumulative: number
  totalCumulative: number
  isFuture: boolean
  isToday: boolean
}

/** 날짜별 누적 제출 건수. 미래 날짜에는 실제 값이 없으므로 0으로만 채우고
 * 절대 임의의 값을 만들지 않는다(호출부는 isFuture로 "아직 데이터 없음"을
 * 구분해서 그려야 한다). */
export function buildCumulativeSeries(
  reports: CareReportRecord[],
  dates: string[],
  todayDate: string,
): CumulativePoint[] {
  const submitted = reports.filter((r) => r.status === 'submitted' && r.report_source !== 'scenario')
  let dailyCum = 0
  let addCum = 0
  return dates.map((date) => {
    const isFuture = date > todayDate
    if (!isFuture) {
      dailyCum += submitted.filter((r) => r.report_date === date && r.report_type === 'daily').length
      addCum += submitted.filter((r) => r.report_date === date && r.report_type === 'additional').length
    }
    return {
      date,
      dailyCumulative: dailyCum,
      additionalCumulative: addCum,
      totalCumulative: dailyCum + addCum,
      isFuture,
      isToday: date === todayDate,
    }
  })
}

type InitialChoiceBucket = 'changed' | 'similar' | 'uncertain' | 'noInfo'

function bucketOf(r: CareReportRecord): InitialChoiceBucket {
  if (r.no_information_report) return 'noInfo'
  if (r.initial_status_choice === 'changed') return 'changed'
  if (r.initial_status_choice === 'uncertain') return 'uncertain'
  return 'similar'
}

export function computeStats(allRows: CareReportRecord[], todayDate: string) {
  const rows = allRows.filter((r) => r.report_source !== 'scenario')
  const submitted = rows.filter((r) => r.status === 'submitted')
  const daily = submitted.filter((r) => r.report_type === 'daily')
  const additional = submitted.filter((r) => r.report_type === 'additional')

  const submittedTodayParticipants = new Set(
    daily.filter((r) => r.report_date === todayDate).map((r) => r.participant_code),
  )
  const todaySubmittedCount = submittedTodayParticipants.size
  const todayNotSubmittedCodes = PARTICIPANT_CODES.filter((c) => !submittedTodayParticipants.has(c))

  const participantsWithSubmission = new Set(submitted.map((r) => r.participant_code))
  const submissionCountByParticipant = new Map<string, number>()
  for (const r of submitted) {
    submissionCountByParticipant.set(r.participant_code, (submissionCountByParticipant.get(r.participant_code) ?? 0) + 1)
  }
  const repeatUsers = [...submissionCountByParticipant.values()].filter((n) => n >= 2).length

  const completionSeconds = submitted.map((r) => r.completion_seconds).filter((n): n is number => typeof n === 'number')

  const voiceCount = submitted.filter((r) => r.input_method === 'voice').length
  const textCount = submitted.filter((r) => r.input_method === 'text').length

  const rawEvaluated = submitted.filter((r) => r.raw_evaluated_at)
  const aiEvaluated = submitted.filter((r) => r.ai_evaluated_at)

  const rawActionable = fraction(rawEvaluated.filter((r) => r.raw_immediately_actionable === true).length, rawEvaluated.length)
  const aiActionable = fraction(aiEvaluated.filter((r) => r.ai_immediately_actionable === true).length, aiEvaluated.length)
  const rawFollowupNeeded = fraction(rawEvaluated.filter((r) => r.raw_followup_needed === true).length, rawEvaluated.length)
  const aiFollowupNeeded = fraction(aiEvaluated.filter((r) => r.ai_followup_needed === true).length, aiEvaluated.length)
  const rawNoFollowupNeeded = fraction(rawEvaluated.filter((r) => r.raw_followup_needed === false).length, rawEvaluated.length)
  const aiNoFollowupNeeded = fraction(aiEvaluated.filter((r) => r.ai_followup_needed === false).length, aiEvaluated.length)

  const pairedEvaluated = submitted.filter((r) => r.raw_evaluated_at && r.ai_evaluated_at)
  const rawCompletenessAvg = average(pairedEvaluated.map((r) => r.raw_completeness_score ?? 0))
  const aiCompletenessAvg = average(pairedEvaluated.map((r) => r.ai_completeness_score ?? 0))
  const completenessDelta =
    rawCompletenessAvg !== null && aiCompletenessAvg !== null ? Math.round((aiCompletenessAvg - rawCompletenessAvg) * 100) / 100 : null

  // 자동 정보충실도(0~4) — 관리자 수동 평가(1~5)와는 별개 지표.
  const informativenessBefore = average(submitted.map((r) => computeRawInformativeness(r.raw_input)))
  const informativenessAfter = average(
    submitted.map((r) => computeInformativeness(r.caregiver_final_report ?? r.ai_generated_report)),
  )

  const actualFollowupOccurred = fraction(
    aiEvaluated.filter((r) => r.actual_followup_type === 'sms' || r.actual_followup_type === 'call').length,
    aiEvaluated.length,
  )

  const noEditCount = submitted.filter((r) => deepEqual(r.ai_generated_report, r.caregiver_final_report)).length

  // 구조화 완료율 = 분자: 최종 제출(status='submitted')된 보고 수 / 분모: 시작한
  // 전체 보고(draft 포함) 수. rows.length가 0이면 fraction()이 percent=null을
  // 돌려주므로 화면에서 "평가 전"으로 자연스럽게 표시된다(가짜 0% 아님).
  const completionRate = fraction(submitted.length, rows.length)

  // AI 초안 수정률 = 분자: ai_generated_report와 caregiver_final_report가 정규화
  // 텍스트 기준으로 다른(=요양보호사가 고쳐서 낸) 보고 수 / 분모: 제출 보고 수.
  // 의미 유사도(AI) 판정은 이번 범위에서 제외하고 공백만 다른 경우를 "안 고침"으로
  // 잘못 세지 않도록 정규화(trim + 공백 압축) 텍스트 비교만 한다. submitted.length=0이면
  // percent=null → "평가 전"으로 표시.
  const aiDraftEditedCount = submitted.filter((r) => !reportTextEquivalent(r.ai_generated_report, r.caregiver_final_report)).length
  const aiDraftEditRate = fraction(aiDraftEditedCount, submitted.length)

  // AI 추가질문 발생률 = 분자: followup_questions.length>0인 제출 보고 수 / 분모: 제출
  // 보고 수 전체. "특이사항 없음" 흐름의 질문(no_change_followup_count)은 이 필드에
  // 안 들어가므로, 여기 잡히는 건 changed/uncertain 초기선택에서 AI가 실제로 던진
  // 질문이 있는 보고만이다(의도된 범위 — 두 흐름의 질문 체계가 서로 다른 필드).
  const followupOccurredRate = fraction(submitted.filter((r) => r.followup_questions.length > 0).length, submitted.length)

  // 추가정보 발견률 = 분자: information_added_count>0인 제출 보고 수(모든 초기선택
  // 통틀어) / 분모: 제출 보고 수 전체. information_added_count는 "질문한 횟수"가
  // 아니라 "흐름 시작 시점에는 없었던 새 changed 도메인 수"만 세도록 고쳤다(버그
  // 수정 — computeInformationAddedCount 참고). changed 초기선택 보고는 이 필드를
  // 건드리지 않아 기본값 0을 유지하므로 분모에는 포함되지만 분자에는 기여하지 않는다.
  const infoAddedRate = fraction(submitted.filter((r) => r.information_added_count > 0).length, submitted.length)

  // AI 사실오류율 = 분자: ai_inaccuracy_detected=true / 분모: 관리자 2단계 평가가
  // 끝난(ai_evaluated_at 존재) 보고 수. 평가 전이면 분모 0 → "평가 전" 표시.
  const inaccuracyRate = fraction(
    aiEvaluated.filter((r) => r.ai_inaccuracy_detected === true).length,
    aiEvaluated.length,
  )

  // 현장보고 유형 분류 (평소와 다름 / 평소와 비슷 / 확인 필요 / 무정보 보고)
  const buckets: Record<InitialChoiceBucket, CareReportRecord[]> = { changed: [], similar: [], uncertain: [], noInfo: [] }
  for (const r of submitted) buckets[bucketOf(r)].push(r)
  const reportTypeBreakdown = {
    changed: fraction(buckets.changed.length, submitted.length),
    similar: fraction(buckets.similar.length, submitted.length),
    uncertain: fraction(buckets.uncertain.length, submitted.length),
    noInfo: fraction(buckets.noInfo.length, submitted.length),
  }

  // 무정보 보고 구체화율: 최초 입력이 "특이사항 없음"이었던 건 중 최종적으로
  // 구체적 관찰정보가 1개 이상 확보된 비율.
  const noChangeInitial = submitted.filter((r) => r.no_change_initial_input)
  const noChangeSpecified = noChangeInitial.filter((r) => r.final_information_count >= 1)
  const noInfoSpecificationRate = fraction(noChangeSpecified.length, noChangeInitial.length)
  const avgAddedDomains = average(noChangeInitial.map((r) => r.information_added_count))

  // 특이사항 없음 → 추가정보 발견률 = 분자: no_change_initial_input=true인 보고 중
  // information_added_count>0 / 분모: no_change_initial_input=true인 보고 수 전체.
  // 이번 실증에서 가장 중요한 지표다. information_added_count는 도메인이 "언급된
  // 횟수"가 아니라 "새로 changed로 밝혀진 도메인 수"만 세도록 고쳤으므로("평소와
  // 같아요"류 답변은 0으로 유지), 이 비율이 실제로 "정말 새 사실이 나왔는가"를
  // 반영한다. noChangeInitial.length=0(아직 이런 보고가 없음)이면 fraction()이
  // percent=null을 돌려주고, 화면은 그걸 "평가 전"으로 표시한다 — 가짜 숫자 없음.
  const noChangeInfoFound = noChangeInitial.filter((r) => r.information_added_count > 0)
  const noChangeToInfoFoundRate = fraction(noChangeInfoFound.length, noChangeInitial.length)

  // 미확인 구분률: "평소와 비슷했어요" 흐름에서 미확인 항목이 있었던 보고 중,
  // 확인된 항목과 미확인 항목을 실제로 구분해 함께 보여준 비율.
  const similarWithUnclear = buckets.similar.filter(
    (r) => r.unobserved_domains_json.length + r.uncertain_domains_json.length > 0,
  )
  const similarWithUnclearSeparated = similarWithUnclear.filter(
    (r) => r.observed_domains_json.length + r.changed_domains_json.length > 0 || r.no_information_report,
  )
  const unconfirmedSeparationRate = fraction(similarWithUnclearSeparated.length, similarWithUnclear.length)

  // 반복 무정보 보고: 동일 참여자가 최근 3건 연속으로 무정보 보고만 제출.
  const repeatNoInfoParticipants: string[] = []
  for (const code of PARTICIPANT_CODES) {
    const own = submitted
      .filter((r) => r.participant_code === code)
      .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))
    const lastThree = own.slice(-3)
    if (lastThree.length === 3 && lastThree.every((r) => r.no_information_report)) {
      repeatNoInfoParticipants.push(code)
    }
  }

  // 질문 부담 지표 (평소와 비슷했어요 흐름)
  const similarStarted = rows.filter((r) => r.initial_status_choice === 'similar')
  const similarSubmitted = similarStarted.filter((r) => r.status === 'submitted')
  const avgNoChangeFollowupCount = average(similarSubmitted.map((r) => r.no_change_followup_count))
  const noChangeFollowupAnswerRate = fraction(
    similarSubmitted.reduce((sum, r) => sum + r.no_change_followup_answered, 0),
    similarSubmitted.reduce((sum, r) => sum + r.no_change_followup_count, 0),
  )
  const noChangeCompletionSecondsMedian = median(
    similarSubmitted.map((r) => r.completion_seconds).filter((n): n is number => typeof n === 'number'),
  )
  const noChangeAbandonRate = fraction(similarStarted.length - similarSubmitted.length, similarStarted.length)

  return {
    coreHeadline: fraction(
      aiEvaluated.filter((r) => r.ai_immediately_actionable === true && r.ai_followup_needed === false).length,
      aiEvaluated.length,
    ),
    participation: {
      activeParticipants: PARTICIPANT_CODES.length,
      participantsWithAtLeastOne: participantsWithSubmission.size,
      todaySubmitted: todaySubmittedCount,
      todayNotSubmitted: PARTICIPANT_CODES.length - todaySubmittedCount,
      todayNotSubmittedCodes,
      repeatUserRate: fraction(repeatUsers, participantsWithSubmission.size),
      repeatUserRateOfPlanned: fraction(repeatUsers, PARTICIPANT_CODES.length),
      submissionCountByParticipant: Object.fromEntries(submissionCountByParticipant),
    },
    volume: {
      dailyCount: daily.length,
      additionalCount: additional.length,
      totalCount: submitted.length,
      goalMain: fraction(submitted.length, 90),
      goalReference: fraction(submitted.length, 100),
    },
    quality: {
      completionRate,
      completionSecondsMedian: median(completionSeconds),
      voiceVsText: { voice: voiceCount, text: textCount },
      noEditRate: fraction(noEditCount, submitted.length),
      aiDraftEditRate,
      followupOccurredRate,
      infoAddedRate,
      adminEvalCompletionRate: fraction(aiEvaluated.length, submitted.length),
      aiUsefulnessAvg: average(aiEvaluated.map((r) => r.ai_usefulness_score ?? 0)),
      inaccuracyCount: aiEvaluated.filter((r) => r.ai_inaccuracy_detected === true).length,
      inaccuracyEvaluatedCount: aiEvaluated.length,
      inaccuracyRate,
    },
    beforeAfter: {
      rawActionable,
      aiActionable,
      actionableDeltaPp:
        rawActionable.percent !== null && aiActionable.percent !== null
          ? Math.round((aiActionable.percent - rawActionable.percent) * 10) / 10
          : null,
      rawFollowupNeeded,
      aiFollowupNeeded,
      rawNoFollowupNeeded,
      aiNoFollowupNeeded,
      completenessAvgBefore: rawCompletenessAvg,
      completenessAvgAfter: aiCompletenessAvg,
      completenessDelta,
      informativenessBefore,
      informativenessAfter,
      actualFollowupOccurred,
      pairedEvaluatedCount: pairedEvaluated.length,
    },
    reportTypeBreakdown,
    noChangeFlow: {
      noInfoSpecificationRate,
      avgAddedDomains,
      noChangeInitialCount: noChangeInitial.length,
      noChangeInfoFoundCount: noChangeInfoFound.length,
      noChangeToInfoFoundRate,
      unconfirmedSeparationRate,
      repeatNoInfoParticipants,
      avgNoChangeFollowupCount,
      noChangeFollowupAnswerRate,
      noChangeCompletionSecondsMedian,
      noChangeAbandonRate,
    },
  }
}

export type StatsResult = ReturnType<typeof computeStats>

// ── 표준상황 연습 (/care/scenario) — 실제 현장보고와 완전히 분리 집계 ──────
export interface ScenarioDef {
  id: string
  title: string
  prompt: string
  expectedKeywords: string[]
  forbiddenKeywords: string[]
}

export const STANDARD_SCENARIOS: ScenarioDef[] = [
  {
    id: 'scenario_1',
    title: '상황 1 · 식사량 감소와 휘청거림',
    prompt:
      '어르신이 점심을 평소의 절반 정도만 드셨고, 의자에서 일어날 때 두 차례 휘청거리셨다. ' +
      '넘어지지는 않았으며 잠시 앉아서 쉬고 계신다.',
    expectedKeywords: ['절반', '휘청', '앉아서', '쉬'],
    forbiddenKeywords: ['낙상', '골절', '응급실', '119', '의식 저하'],
  },
  {
    id: 'scenario_2',
    title: '상황 2 · 반복 질문과 복약 여부 불분명',
    prompt:
      '어르신이 같은 질문을 여러 차례 반복했고 평소보다 불안해 보였다. 식탁 위에 아침 약이 남아 있지만 ' +
      '실제 복용 여부는 확인되지 않았다.',
    expectedKeywords: ['반복', '불안', '약', '확인되지 않'],
    forbiddenKeywords: ['치매', '복용하지 않았다고 판단', '투약 중단'],
  },
]

export interface ScenarioGrade {
  reportId: string
  scenarioId: string
  expectedFound: number
  expectedTotal: number
  forbiddenTriggered: string[]
  structured: boolean
}

function reportToText(r: CareReportRecord): string {
  const rep = r.caregiver_final_report ?? r.ai_generated_report
  if (!rep) return r.raw_input
  return [r.raw_input, rep.change, rep.action, rep.result, rep.escalation].join(' ')
}

export function gradeScenarioReport(r: CareReportRecord): ScenarioGrade | null {
  const def = STANDARD_SCENARIOS.find((s) => s.id === r.scenario_id)
  if (!def) return null
  const text = reportToText(r)
  const expectedFound = def.expectedKeywords.filter((k) => text.includes(k)).length
  const forbiddenTriggered = def.forbiddenKeywords.filter((k) => text.includes(k))
  return {
    reportId: r.id,
    scenarioId: def.id,
    expectedFound,
    expectedTotal: def.expectedKeywords.length,
    forbiddenTriggered,
    structured: computeInformativeness(r.caregiver_final_report) > 0,
  }
}

export function computeScenarioStats(allRows: CareReportRecord[]) {
  const rows = allRows.filter((r) => r.report_source === 'scenario' && r.status === 'submitted')
  const grades = rows.map(gradeScenarioReport).filter((g): g is ScenarioGrade => g !== null)
  const targetCount = 18 // 9명 × 2건
  return {
    totalCount: rows.length,
    targetCount,
    goal: fraction(rows.length, targetCount),
    byScenario: STANDARD_SCENARIOS.map((s) => ({
      id: s.id,
      title: s.title,
      count: rows.filter((r) => r.scenario_id === s.id).length,
    })),
    requiredInfoCoverage: fraction(
      grades.reduce((sum, g) => sum + g.expectedFound, 0),
      grades.reduce((sum, g) => sum + g.expectedTotal, 0),
    ),
    fabricationCount: grades.filter((g) => g.forbiddenTriggered.length > 0).length,
    structuredRate: fraction(grades.filter((g) => g.structured).length, grades.length),
    // 전문가 2인 검토는 이번 구현 범위 밖 — 임의 생성하지 않는다.
    expertAppropriatenessStatus: 'not_evaluated' as const,
  }
}

export function domainLabelList(entries: DomainEntry[]): string[] {
  return entries.map((e) => e.domain)
}
