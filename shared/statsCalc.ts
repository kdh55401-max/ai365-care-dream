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

type InitialChoiceBucket = 'changed' | 'similar' | 'uncertain' | 'noInfo' | 'unclassified'

/** "평소와 비슷함"은 요양보호사가 실제로 그렇게 선택했거나(initial_status_choice
 * ==='similar') 특이사항없음 흐름을 실제로 거친 보고만을 뜻해야 한다. "이야기
 * 시작"/"글로 입력하기"로 곧바로 자유발화한 기본 돌봄보고는 이 선택 자체를 거치지
 * 않아 initial_status_choice가 null로 남는데, 이를 "평소와 비슷함"으로 흘려보내면
 * 실제로는 분류되지 않은 보고가 마치 정상 상태로 확인된 것처럼 집계된다("미분류"와
 * "정상 확인됨"은 서로 다른 사실이다). 그래서 null은 changed/similar/uncertain
 * 어디에도 넣지 않고 별도 unclassified로 분리한다 — 과거 데이터의 실제 상태를
 * 추정해서 채우지 않는다. */
function bucketOf(r: CareReportRecord): InitialChoiceBucket {
  if (r.no_information_report) return 'noInfo'
  if (r.initial_status_choice === 'changed') return 'changed'
  if (r.initial_status_choice === 'similar') return 'similar'
  if (r.initial_status_choice === 'uncertain') return 'uncertain'
  return 'unclassified'
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

  // 재사용률: 첫 제출일이 오늘이면 "다시 쓸 기회"가 아직 없었을 수 있으므로(다음
  // 방문은 보통 다음날) 관찰 기간이 부족한 참여자로 보고 분모에서 뺀다 — 0%로
  // 뭉뚱그리지 않고 "관찰 중" 인원으로 따로 센다. report_date/todayDate는 모두
  // KST(Asia/Seoul) 기준 날짜 문자열이다(date.ts의 todayKstDateString, demoStore의
  // todayKst — 둘 다 UTC+9 보정 후 잘라 쓴다) — 여기서 별도 시간대 변환은 하지 않는다.
  const firstSubmissionDateByParticipant = new Map<string, string>()
  for (const r of submitted) {
    const cur = firstSubmissionDateByParticipant.get(r.participant_code)
    if (!cur || r.report_date < cur) firstSubmissionDateByParticipant.set(r.participant_code, r.report_date)
  }
  // observationCompleteParticipants가 분모 집합이고, 아래 repeatUsersObservationComplete는
  // 반드시 이 집합 "안에서만" 필터링한다 — 분자가 분모 밖 인원을 포함하지 않게 한다.
  const observationCompleteParticipants = [...participantsWithSubmission].filter((code) => {
    const first = firstSubmissionDateByParticipant.get(code)
    return first !== undefined && first < todayDate
  })
  const stillObservingParticipants = participantsWithSubmission.size - observationCompleteParticipants.length
  const repeatUsersObservationComplete = observationCompleteParticipants.filter((code) => (submissionCountByParticipant.get(code) ?? 0) >= 2).length

  const completionSeconds = submitted.map((r) => r.completion_seconds).filter((n): n is number => typeof n === 'number')
  // 시작~제출 "전체 경과시간"에는 화면을 켜둔 채 대기한 시간 등이 섞일 수 있어,
  // 실제 상호작용 시간과 다르다(과거 기록에는 턴별 타임스탬프가 없어 실제 상호작용
  // 시간 자체를 계산할 방법이 없다 — 추정해서 채우지 않는다). 기본으로 보여줄 값은
  // 항상 medianAllSeconds(전체 경과시간 중앙값)다 — 아래 문턱값 기준 중앙값은
  // 화면에서 보조 정보로만 쓴다. 30분이라는 문턱은 통계적/임상적 근거가 있는 값이
  // 아니라 편의상 정한 기준이다("이보다 길면 화면을 열어둔 채 대기했을 가능성이
  // 있다" 정도의 참고용). 이 기준으로 긴 기록을 임의로 삭제하거나 전체 중앙값에서
  // 빼지 않고, 포함/제외 건수를 항상 함께 보여준다.
  const INTERACTIVE_SECONDS_THRESHOLD = 1800
  const withinThresholdSeconds = completionSeconds.filter((s) => s <= INTERACTIVE_SECONDS_THRESHOLD)
  const completionTime = {
    medianAllSeconds: median(completionSeconds),
    medianWithinThresholdSeconds: median(withinThresholdSeconds),
    thresholdSeconds: INTERACTIVE_SECONDS_THRESHOLD,
    excludedFromThresholdCount: completionSeconds.length - withinThresholdSeconds.length,
    sampleCount: completionSeconds.length,
  }

  const voiceCount = submitted.filter((r) => r.input_method === 'voice').length
  const textCount = submitted.filter((r) => r.input_method === 'text').length

  // AI 폴백(대체) 발생률 — 최종 보고문이 실제 Gemini 응답이 아니라 규칙 기반
  // 대체(fallbackReport)로 만들어진 비율. ai_fallback_used가 null인 건(이 필드가
  // 생기기 전 기록)은 분모에서 제외하고 "확인 불가" 건수로 별도 표시한다 — 과거
  // 기록을 추정해서 채우지 않는다.
  // typeof로 검사한다 — DB 마이그레이션이 아직 적용되지 않아 컬럼 자체가 없는
  // 배포 시점에는 undefined로 들어올 수 있는데, 이를 null과 똑같이 "확인 불가"로
  // 다뤄야 한다(그렇지 않으면 undefined가 !== null이라 "폴백 아님(false)"으로
  // 잘못 집계된다).
  const fallbackTracked = submitted.filter((r) => typeof r.ai_fallback_used === 'boolean')
  const fallbackRate = fraction(fallbackTracked.filter((r) => r.ai_fallback_used === true).length, fallbackTracked.length)
  const fallbackUnknownCount = submitted.length - fallbackTracked.length

  // 구조화 완료율 분모에 "지금 막 시작해서 아직 작성 중인" draft까지 세지 않기 위해
  // draft를 "장기 미완료"와 "진행 중"으로 나눈다. 이 1시간 기준은 관찰 가능한 사실
  // (시작 후 얼마나 지났는가)일 뿐, 실패/중단으로 확정하는 판정이 아니다 — 요양보호사가
  // 나중에 이어서 제출할 수도 있으므로 "abandoned/실패"라고 부르지 않는다. 편의상 정한
  // 임계값이며 임상적/통계적 근거는 없다.
  const LONG_PENDING_DRAFT_MS = 60 * 60 * 1000
  const draftRows = rows.filter((r) => r.status === 'draft')
  const nowMs = Date.now()
  const longPendingDrafts = draftRows.filter((r) => nowMs - new Date(r.started_at).getTime() > LONG_PENDING_DRAFT_MS)
  const inProgressDrafts = draftRows.filter((r) => nowMs - new Date(r.started_at).getTime() <= LONG_PENDING_DRAFT_MS)

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

  // 제출 완료율(예전 이름 "구조화 완료율" — AI 처리 성공 여부와 혼동될 수 있는
  // 이름이라 정정. AI가 실제로 잘 작동했는지는 이 지표가 아니라 fallbackRate를
  // 봐야 한다) = 분자: 최종 제출(status='submitted')된 보고 수 / 분모: 제출 +
  // 장기 미완료 draft 수(방금 시작해 아직 진행 중인 draft는 실패로 볼 수 없어
  // 분모에서 뺀다 — completionBreakdown.inProgress로 별도 표시). 분모가 0이면
  // fraction()이 percent=null을 돌려주므로 화면에서 "평가 전"으로 표시된다.
  const completionRate = fraction(submitted.length, submitted.length + longPendingDrafts.length)
  const completionBreakdown = {
    completed: submitted.length,
    longPending: longPendingDrafts.length,
    inProgress: inProgressDrafts.length,
    longPendingThresholdHours: LONG_PENDING_DRAFT_MS / (60 * 60 * 1000),
  }

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

  // 현장보고 유형 분류 (평소와 다름 / 평소와 비슷 / 확인 필요 / 무정보 보고 / 미분류)
  const buckets: Record<InitialChoiceBucket, CareReportRecord[]> = {
    changed: [], similar: [], uncertain: [], noInfo: [], unclassified: [],
  }
  for (const r of submitted) buckets[bucketOf(r)].push(r)
  const reportTypeBreakdown = {
    changed: fraction(buckets.changed.length, submitted.length),
    similar: fraction(buckets.similar.length, submitted.length),
    uncertain: fraction(buckets.uncertain.length, submitted.length),
    noInfo: fraction(buckets.noInfo.length, submitted.length),
    unclassified: fraction(buckets.unclassified.length, submitted.length),
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
      // 첫 제출일이 오늘인 참여자는 아직 "다시 쓸 기회"가 없었을 수 있어 분모에서
      // 제외한다(stillObservingParticipants로 별도 표시) — 관찰 기간 부족을 0%로
      // 뭉개지 않기 위함.
      repeatUserRate: fraction(repeatUsersObservationComplete, observationCompleteParticipants.length),
      repeatUserRateOfPlanned: fraction(repeatUsers, PARTICIPANT_CODES.length),
      stillObservingParticipants,
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
      completionBreakdown,
      completionSecondsMedian: completionTime.medianAllSeconds,
      completionTime,
      voiceVsText: { voice: voiceCount, text: textCount },
      noEditRate: fraction(noEditCount, submitted.length),
      aiDraftEditRate,
      followupOccurredRate,
      infoAddedRate,
      fallbackRate,
      fallbackUnknownCount,
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
