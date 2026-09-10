import { useEffect, useRef, useState } from 'react'
import { ApiClientError } from '../shared/api'
import { useContinuousVoice } from './useContinuousVoice'
import { TopCallBar, SafetyFooter, PrivacyNotice } from '../shared/SafetyNotice'
import type { AiTurnResult, CareReportDetail, CareReportListItem, DomainEntry, FollowupItem, StructuredReport } from '../shared/types'
import { DOMAIN_LABELS } from '../shared/types'
import type { CareRepo } from '../shared/careRepo'
import { realCareRepo } from '../shared/careRepo'
import { isDemoMode } from '../shared/demoMode'
import { demoCareRepo } from '../demo/demoCareRepo'
import { resetDemoData, DEMO_ALIAS_PASSWORD } from '../demo/demoStore'
import {
  buildNoChangeReport,
  classifyDomainsFromText,
  computeInformationAddedCount,
  detectNoChangePhrase,
  mergeDomainEntries,
  NO_CHANGE_QUESTION_1,
  NO_CHANGE_QUESTION_2,
  shouldSkipFirstQuestion,
  shouldSkipSecondQuestion,
} from '../../../shared/noChangeEngine'
import { STANDARD_SCENARIOS } from '../../../shared/statsCalc'
import { detectEmergencyPhrase } from '../../../shared/emergency'
import { detectStopRequest } from '../../../shared/stopRequest'
import { extractCaregiverNote } from '../../../shared/caregiverNote'

const CENTER_PHONE = import.meta.env.VITE_CENTER_PHONE_NUMBER?.trim() || undefined

type Screen =
  | 'home'
  | 'scenarioSelect'
  | 'statusChoice'
  | 'record'
  | 'emergency'
  | 'noChangeQuestion'
  | 'question'
  | 'reportReview'
  | 'submitted'
  | 'history'
  | 'historyDetail'
type ReportType = 'daily' | 'additional'
type InitialChoice = 'changed' | 'similar' | 'uncertain' | null

const DRAFT_KEY_PREFIX = 'ai365_care_pilot_draft_'
const CURRENT_RECIPIENT_KEY_PREFIX = 'ai365_care_current_recipient_'
const REPORT_TYPE_LABEL: Record<ReportType, string> = { daily: '기본', additional: '추가' }

/** 이 기기에서 이 요양보호사가 마지막으로 선택한(=현재 서비스 중인) 수급자 코드를
 * 기억해 두는 키. 실제 서비스에서는 방문 세션/NFC가 이 역할을 대신하지만, 그
 * 정보가 없는 지금은 "마지막으로 고른 대상자"를 현재 방문으로 간주해 재로그인 시
 * 다시 고르지 않게 한다. */
function currentRecipientKey(demo: boolean, participantCode: string) {
  return `${CURRENT_RECIPIENT_KEY_PREFIX}${demo ? 'demo_' : ''}${participantCode}`
}

/** "오늘 기본보고를 이미 냈는지"를 항상 지금 선택된 수급자 기준으로 판단한다.
 * (참여자+날짜+종류만으로 판단하면 다른 수급자 몫과 뒤섞인다 — 설계 검토 결정 D3). */
function computeDailySubmitted(list: CareReportListItem[], recipientCode: string, today: string): boolean {
  if (!recipientCode) return false
  return list.some(
    (r) =>
      r.recipient_code === recipientCode &&
      r.report_date === today &&
      r.report_type === 'daily' &&
      (r.report_source ?? 'live') === 'live' &&
      r.status === 'submitted',
  )
}

function emptyReport(): StructuredReport {
  return { change: '', action: '', result: '', escalation: '', caregiverNote: '' }
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className ?? ''}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const FIELD_LABELS: Array<{ key: keyof StructuredReport; label: string }> = [
  { key: 'change', label: '관찰한 돌봄 상황' },
  { key: 'action', label: '현장에서 한 조치' },
  { key: 'result', label: '현재 상태' },
  { key: 'escalation', label: '센터 확인사항' },
  { key: 'caregiverNote', label: '요양보호사 상황·지원 요청 (발화 원문 발췌)' },
]

function DemoBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className="w-full max-w-md mx-auto mb-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2 flex items-center justify-between gap-2">
      <span className="text-amber-700 text-xs font-bold">DEMO DATA · 실제 실증 결과가 아닙니다</span>
      <button onClick={onReset} className="text-amber-700 text-xs font-bold underline shrink-0">
        데모 초기화
      </button>
    </div>
  )
}

function Shell({ demo, onResetDemo, children }: { demo: boolean; onResetDemo: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-6">
      {demo && <DemoBanner onReset={onResetDemo} />}
      <TopCallBar />
      <div className="w-full max-w-md flex-1 flex flex-col">{children}</div>
      <SafetyFooter />
    </div>
  )
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props
  return (
    <button
      {...rest}
      className={`w-full min-h-[52px] rounded-full bg-teal-600 text-white text-lg font-bold py-3
                  hover:bg-teal-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed ${className ?? ''}`}
    />
  )
}
function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props
  return (
    <button
      {...rest}
      className={`w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700
                  text-lg font-bold py-3 hover:bg-slate-50 transition disabled:opacity-50 ${className ?? ''}`}
    />
  )
}

function LoginScreen({ demo, onLogin }: { demo: boolean; onLogin: (code: string, pin: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(null)
    setLoading(true)
    try {
      await onLogin(code.trim().toUpperCase(), pin.trim())
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Shell demo={demo} onResetDemo={() => undefined}>
      <div className="flex flex-col items-center justify-center flex-1 gap-8 py-10">
        <div className="text-center">
          <p className="text-base font-semibold tracking-wide text-teal-600">AI365 CARE DREAM</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">목표 60초 AI 돌봄보고</h1>
          <p className="text-slate-500 text-base mt-2 leading-relaxed">
            60초는 목표 시간이에요. 더 걸려도 괜찮으니 오늘 돌봄 내용을 편하게 들려주세요.
          </p>
          {demo && (
            <p className="text-amber-600 text-xs mt-2 font-bold">
              데모 계정 c1 ~ c9 / 비밀번호 {DEMO_ALIAS_PASSWORD}
            </p>
          )}
        </div>

        <div className="w-full flex flex-col gap-4">
          <div>
            <label className="block font-bold text-slate-900 text-base mb-1">참여자 코드</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={demo ? '예: c1' : '예: C01'}
              className="w-full text-lg border border-slate-300 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoCapitalize={demo ? 'none' : 'characters'}
            />
          </div>
          <div>
            <label className="block font-bold text-slate-900 text-base mb-1">{demo ? '비밀번호' : 'PIN'}</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              type="password"
              inputMode="numeric"
              placeholder="숫자 4자리"
              className="w-full text-lg border border-slate-300 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          {error && <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">{error}</p>}
          <PrimaryButton onClick={submit} disabled={!code || !pin || loading}>
            {loading ? '확인 중...' : '로그인'}
          </PrimaryButton>
          <p className="text-center text-slate-400 text-xs">
            코드와 PIN은 센터 관리자에게 문의하세요. 이 기기에서 2주간 로그인이 유지됩니다.
          </p>
        </div>
      </div>
    </Shell>
  )
}

/** 현재 서비스 중인 수급자를 보여주는 작은 카드. 수급자 코드 선택을 메인 절차로
 * 만들지 않기 위해, 큰 드롭다운 대신 이미 연결된 대상자를 카드로만 보여주고
 * "대상자 변경"은 배정된 대상자가 2명 이상일 때만 노출되는 보조 동작이다. */
function CurrentRecipientCard({
  recipientCode,
  recipientCodes,
  showPicker,
  onTogglePicker,
  onSelect,
}: {
  recipientCode: string
  recipientCodes: string[]
  showPicker: boolean
  onTogglePicker: () => void
  onSelect: (code: string) => void
}) {
  if (recipientCodes.length === 0) {
    return (
      <div className="rounded-3xl bg-amber-50 border border-amber-200 p-5 text-center">
        <p className="font-bold text-amber-800">배정된 수급자가 없습니다.</p>
        <p className="text-amber-700 text-sm mt-1">관리자에게 문의해 주세요.</p>
      </div>
    )
  }

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-xs font-bold">오늘 돌봄 대상</p>
          <p className="text-slate-900 text-2xl font-bold mt-0.5">{recipientCode} 어르신</p>
          <p className="text-teal-700 text-sm font-bold mt-1">방문요양 · 서비스 진행 중</p>
        </div>
        {recipientCodes.length > 1 && (
          <button onClick={onTogglePicker} className="text-slate-400 text-sm font-bold underline shrink-0">
            대상자 변경
          </button>
        )}
      </div>
      {showPicker && recipientCodes.length > 1 && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2">
          <p className="text-slate-500 text-xs">내가 담당하는 수급자만 표시됩니다.</p>
          {recipientCodes.map((c) => (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className={`text-left rounded-2xl border px-4 py-2.5 font-bold transition ${
                c === recipientCode
                  ? 'border-teal-500 bg-teal-50 text-teal-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CareApp() {
  const demo = isDemoMode()
  const repo: CareRepo = demo ? demoCareRepo : realCareRepo
  const scenarioRoute = window.location.pathname.startsWith('/care/scenario')

  const [phase, setPhase] = useState<'loading' | 'login' | 'app'>('loading')
  const [participantCode, setParticipantCode] = useState<string | null>(null)
  const [today, setToday] = useState('')
  const [dailySubmitted, setDailySubmitted] = useState(false)
  const [recipientCodes, setRecipientCodes] = useState<string[]>([])
  const [recentReports, setRecentReports] = useState<CareReportListItem[]>([])
  const [historyDetail, setHistoryDetail] = useState<CareReportDetail | null>(null)

  const [screen, setScreen] = useState<Screen>('home')
  const [recipientCode, setRecipientCode] = useState('')
  const [reportType, setReportType] = useState<ReportType>('daily')
  const [reportId, setReportId] = useState<string | null>(null)
  const [rawInput, setRawInput] = useState('')
  const [inputMethod, setInputMethod] = useState<'voice' | 'text'>('text')
  const [initialChoice, setInitialChoice] = useState<InitialChoice>(null)
  const [followupHistory, setFollowupHistory] = useState<FollowupItem[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<{
    question: string
    missingField: string
    options?: string[]
    allowMultiple?: boolean
  } | null>(null)
  const [answerText, setAnswerText] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  // 옵션이 있는 질문이라도 상황에 안 맞으면 "다른 내용 말하기"로 자유 입력(텍스트/음성)을
  // 열 수 있다. 옵션이 아예 없는 질문(AI가 채우지 못한 경우)은 처음부터 자유 입력만 보인다.
  const [showFreeAnswer, setShowFreeAnswer] = useState(false)
  const [aiGeneratedReport, setAiGeneratedReport] = useState<StructuredReport | null>(null)
  const [finalReport, setFinalReport] = useState<StructuredReport>(emptyReport())

  // 특이사항 없음(평소와 비슷했어요) 흐름 전용 상태
  const [noChangeEntries, setNoChangeEntries] = useState<DomainEntry[]>([])
  const [noChangeStep, setNoChangeStep] = useState<0 | 1 | 2>(0)
  const [noChangeAnswered, setNoChangeAnswered] = useState(0)
  const [initialInfoCount, setInitialInfoCount] = useState(0)
  const [noChangeInitialInput, setNoChangeInitialInput] = useState(false)
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null)
  const [scenarioSubmittedCount, setScenarioSubmittedCount] = useState(0)
  const [showRecipientPicker, setShowRecipientPicker] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 저장/AI 호출이 실패했을 때, 방금 하려던 동작을 그대로 다시 시도할 수 있게
  // 보관해 둔다("재시도로 같은 보고가 중복 저장되지 않게" — reportId가 이미
  // 만들어진 뒤의 재시도이므로 patch만 반복될 뿐 새 보고가 다시 생기지 않는다).
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null)
  const CONNECTION_ERROR_MESSAGE = '잠시 연결이 어려워요. 다시 시도해주세요.'
  // 최초 관찰 입력용 음성 인식(홈에서 버튼을 누르면 바로 시작). 짧은 무음이나
  // 브라우저의 예기치 않은 세션 종료에도 이어서 들을 수 있도록 useContinuousVoice가
  // 재연결을 흡수한다 — 사용자가 "말하기 완료"를 눌러야 끝난다.
  const voice = useContinuousVoice()
  // 후속 질문 화면에서 "다른 내용 말하기"로 자유 입력을 열었을 때 쓰는 별도 세션.
  const answerVoice = useContinuousVoice()
  // "특이사항 없음" 흐름 시작 시점의 도메인 분류 스냅샷. information_added_count는
  // 이 스냅샷과 최종 분류를 비교해 "새로 changed로 바뀐 도메인"만 세야 하므로,
  // 매 답변마다 덮어써지는 noChangeEntries와는 별도로 고정해 둔다.
  const initialNoChangeEntriesRef = useRef<DomainEntry[]>([])
  // "특이사항 없음" 흐름에서 실제로 AI가 던진 질문·요양보호사의 답변 원문을
  // changed 흐름과 같은 followup_questions/followup_answers 필드에 남기기 위한
  // 임시 누적 버퍼. no_change_followup_count(질문 "횟수")는 그대로 유지하면서,
  // 실제 문답 내용도 함께 기록해 관리자가 무슨 질문·답변이 오갔는지 볼 수 있게 한다.
  const noChangeQaHistoryRef = useRef<FollowupItem[]>([])
  // "특이사항 없음" 흐름에서 실제로 오간 원문(최초 입력 + 답변들). caregiverNote는
  // 이 흐름도 어려움 호소를 다룰 수 있어("특이사항 없는데 힘들어요") 매번 이 전체
  // 원문에서 새로 추출한다 — 흐름 시작 시 무조건 빈 문자열로 두지 않는다.
  const noChangeRawTextsRef = useRef<string[]>([])
  // "특이사항 없음" 흐름에서 실제로 화면에 보여준 질문 수(응답 내용 유무와 무관).
  // 1번 질문을 건너뛰는 경우(shouldSkipFirstQuestion) noChangeStep이 1이 아니라
  // 2에서 시작하므로, "단계 번호"를 그대로 "질문 횟수"로 쓰면 실제보다 많이 셀 수
  // 있어 별도로 센다 — 설계 검토 결정 D2/기록 정확성.
  const noChangeStepsAskedRef = useRef(0)
  // 응급 화면으로 넘어오기 직전 화면(뒤로가기용) — 정보 손실 없이 돌아갈 수 있게.
  const [emergencyDraftText, setEmergencyDraftText] = useState('')

  const draftKey = participantCode ? `${DRAFT_KEY_PREFIX}${demo ? 'demo_' : ''}${participantCode}` : null

  const saveDraft = () => {
    if (!draftKey || !reportId) return
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          reportId, reportType, recipientCode, rawInput, initialChoice, followupHistory, currentQuestion,
          aiGeneratedReport, finalReport, screen, noChangeEntries, noChangeStep, noChangeAnswered, initialInfoCount,
          noChangeInitialInput, initialNoChangeEntries: initialNoChangeEntriesRef.current,
        }),
      )
    } catch {
      // 저장 공간을 쓸 수 없어도 진행을 막지 않는다.
    }
  }
  const clearDraft = () => {
    if (draftKey) {
      try {
        localStorage.removeItem(draftKey)
      } catch {
        // 무시
      }
    }
  }

  const homeScreenName: Screen = scenarioRoute ? 'scenarioSelect' : 'home'

  const loadHome = async (code: string, navigateToHome = true) => {
    const session = await repo.getSession()
    setToday(session.today)
    // 로그인한 요양보호사에게 배정된 수급자만 표시한다 — 배정이 없으면 빈 목록
    // 그대로 둔다(다른 요양보호사의 수급자로 대체하지 않는다).
    const assigned = session.recipientCodes
    setRecipientCodes(assigned)
    let activeRecipient = ''
    if (assigned.length > 0) {
      const key = currentRecipientKey(demo, code)
      let current = assigned[0]
      try {
        const saved = localStorage.getItem(key)
        if (saved && assigned.includes(saved)) current = saved
      } catch {
        // 저장 공간을 쓸 수 없어도 첫 번째 배정 대상으로 진행한다.
      }
      activeRecipient = current
      setRecipientCode(current)
    } else {
      setRecipientCode('')
    }
    const list = await repo.listReports()
    setRecentReports(list)
    // "오늘 기본보고를 남겼는지"는 요양보호사 전체가 아니라 지금 선택된 수급자
    // 기준이어야 한다 — 다른 수급자(예: A02) 몫을 이미 제출했다고 해서 지금
    // 보고 있는 수급자(예: A01)까지 완료로 표시되거나 시작 버튼이 숨으면 안
    // 된다(설계 검토 결정 D3). session.dailyReportToday는 참여자 단위라 이
    // 목적에 쓰지 않는다.
    setDailySubmitted(computeDailySubmitted(list, activeRecipient, session.today))
    setScenarioSubmittedCount(list.filter((r) => r.report_source === 'scenario' && r.status === 'submitted').length)

    if (!navigateToHome) return

    const draftKeyLocal = `${DRAFT_KEY_PREFIX}${demo ? 'demo_' : ''}${code}`
    try {
      const raw = localStorage.getItem(draftKeyLocal)
      if (raw) {
        const draft = JSON.parse(raw)
        const detail = await repo.getReport(draft.reportId)
        if (detail.status === 'draft') {
          setReportId(draft.reportId)
          setReportType(draft.reportType)
          setRecipientCode(draft.recipientCode)
          setRawInput(draft.rawInput)
          setInitialChoice(draft.initialChoice ?? null)
          setFollowupHistory(draft.followupHistory ?? [])
          setCurrentQuestion(draft.currentQuestion ?? null)
          setAiGeneratedReport(draft.aiGeneratedReport ?? null)
          setFinalReport(draft.finalReport ?? emptyReport())
          setNoChangeEntries(draft.noChangeEntries ?? [])
          setNoChangeStep(draft.noChangeStep ?? 0)
          // 새로고침으로 복원되는 draft에는 "실제로 몇 번 물었는지" 카운터가
          // 저장돼 있지 않다 — 기존 draft 필드(noChangeStep)로 근사해 이전
          // 동작과 동일한 수준을 유지한다(완전한 정확도는 이 draft 스키마
          // 확장이 필요해 이번 최소 수정 범위 밖).
          noChangeStepsAskedRef.current = draft.noChangeStep ?? 0
          setNoChangeAnswered(draft.noChangeAnswered ?? 0)
          setInitialInfoCount(draft.initialInfoCount ?? 0)
          initialNoChangeEntriesRef.current = draft.initialNoChangeEntries ?? []
          setNoChangeInitialInput(draft.noChangeInitialInput ?? false)
          setScreen(draft.screen)
          return
        }
        localStorage.removeItem(draftKeyLocal)
      }
    } catch {
      // 복원 실패는 조용히 무시하고 홈 화면부터 시작한다.
    }
    setScreen(homeScreenName)
  }

  useEffect(() => {
    void (async () => {
      try {
        const session = await repo.getSession()
        if (session.authenticated && session.participantCode) {
          setParticipantCode(session.participantCode)
          await loadHome(session.participantCode)
          setPhase('app')
        } else {
          setPhase('login')
        }
      } catch {
        setPhase('login')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!draftKey || !reportId) return
    saveDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, rawInput, followupHistory, currentQuestion, aiGeneratedReport, finalReport, noChangeEntries, noChangeStep])

  // 마이크 권한 거부/미지원처럼 "재연결로 해결되지 않는" 음성 오류만 화면 공용
  // 오류 배너에 반영한다. 재연결 시도 중 메시지는 record 화면의 전용 안내로 이미
  // 보여주므로 여기서 중복 표시하지 않는다.
  useEffect(() => {
    if (voice.state === 'idle' && voice.error) setError(voice.error)
  }, [voice.state, voice.error])
  useEffect(() => {
    if (answerVoice.state === 'idle' && answerVoice.error) setError(answerVoice.error)
  }, [answerVoice.state, answerVoice.error])

  const handleLogin = async (code: string, pin: string) => {
    await repo.login(code, pin)
    // 데모 모드 별칭 로그인(c1→C01 등)처럼 로그인에 쓴 입력과 실제 참여자
    // 코드가 다를 수 있으므로, 로그인 직후 세션을 다시 조회해 정규화된
    // 코드를 신뢰한다(직접 넘긴 code를 그대로 쓰지 않는다).
    const session = await repo.getSession()
    const resolvedCode = session.authenticated && session.participantCode ? session.participantCode : code
    setParticipantCode(resolvedCode)
    await loadHome(resolvedCode)
    setPhase('app')
  }
  const handleLogout = async () => {
    await repo.logout().catch(() => undefined)
    setParticipantCode(null)
    setPhase('login')
  }
  const handleResetDemo = () => {
    resetDemoData()
    window.location.reload()
  }

  const selectRecipient = (code: string) => {
    setRecipientCode(code)
    // 대상자를 바꾸면 "오늘 기본보고 제출 여부"도 그 대상자 기준으로 다시
    // 계산한다 — 이전 대상자의 완료 상태가 그대로 남아 있으면 안 된다(D3).
    setDailySubmitted(computeDailySubmitted(recentReports, code, today))
    setShowRecipientPicker(false)
    if (participantCode) {
      try {
        localStorage.setItem(currentRecipientKey(demo, participantCode), code)
      } catch {
        // 저장 공간을 쓸 수 없어도 화면 진행은 막지 않는다.
      }
    }
  }

  const resetFlow = () => {
    voice.cancel()
    answerVoice.cancel()
    clearDraft()
    setReportId(null)
    setRawInput('')
    setInitialChoice(null)
    setFollowupHistory([])
    setCurrentQuestion(null)
    setAiGeneratedReport(null)
    setFinalReport(emptyReport())
    setAnswerText('')
    setSelectedOptions([])
    setShowFreeAnswer(false)
    setNoChangeEntries([])
    setNoChangeStep(0)
    setNoChangeAnswered(0)
    setInitialInfoCount(0)
    setNoChangeInitialInput(false)
    setActiveScenarioId(null)
    setEmergencyDraftText('')
    setError(null)
    setRetryAction(null)
    setScreen(homeScreenName)
  }

  const startReport = async (type: ReportType, voiceAutoStart = true) => {
    if (!recipientCode) {
      setError('배정된 수급자가 없습니다. 관리자에게 문의해 주세요.')
      return
    }
    setError(null)
    setRetryAction(null)
    setLoading(true)
    try {
      const res = await repo.createReport({ recipientCode, reportType: type, inputMethod })
      setReportId(res.report.id)
      setReportType(type)
      setRawInput(res.report.raw_input ?? '')
      setFollowupHistory(res.report.followup_answers ?? [])
      setAiGeneratedReport(res.report.ai_generated_report)
      setFinalReport(res.report.caregiver_final_report ?? emptyReport())
      // 기본 돌봄보고는 "버튼 한 번 → AI와 대화"가 핵심 동선이므로 상황선택 메뉴를
      // 거치지 않고 바로 대화(record) 화면으로 간다. "특이사항 없음" 계열 발화는
      // handleSubmitRaw의 detectNoChangePhrase가 자유발화 안에서 그대로 감지한다.
      // 추가 상태변화 보고는 명시적으로 변화를 짚어보는 보고이므로 기존 상황선택
      // 메뉴를 그대로 유지한다.
      setInitialChoice(null)
      setScreen(type === 'daily' ? 'record' : 'statusChoice')
      // 기본 돌봄보고를 "이야기 시작"으로 처음 열 때(이어서 하는 draft 복원이 아닐
      // 때)는 버튼을 누른 즉시 음성 입력을 시작한다 — "버튼 누르고 편하게
      // 말씀해주세요"가 핵심 동선이라 record 화면에서 마이크를 한 번 더 누르게
      // 하지 않는다. "글로 입력하기"로 들어온 경우(voiceAutoStart=false)는 문자
      // 입력을 기대하고 온 것이므로 마이크를 자동으로 켜지 않는다. 지원하지 않는
      // 기기/권한 거부는 훅 내부에서 error로 알려주고 화면은 텍스트 입력으로 그대로
      // 진행할 수 있다.
      if (type === 'daily' && !res.resumed && voiceAutoStart && voice.isSupported) {
        setInputMethod('voice')
        voice.start()
      }
    } catch {
      // createReport는 daily/additional 모두 "최근 빈 draft 재사용"으로 재시도-안전하다
      // (같은 요청을 다시 보내도 새 보고가 중복 생성되지 않는다).
      setError(CONNECTION_ERROR_MESSAGE)
      setRetryAction(() => () => void startReport(type))
    } finally {
      setLoading(false)
    }
  }

  const startScenario = async (scenarioId: string) => {
    if (!recipientCode) {
      setError('수급자 코드를 먼저 선택해 주세요.')
      return
    }
    const def = STANDARD_SCENARIOS.find((s) => s.id === scenarioId)
    if (!def) return
    setError(null)
    setLoading(true)
    try {
      const res = await repo.createReport({
        recipientCode,
        reportType: 'additional',
        inputMethod: 'text',
        reportSource: 'scenario',
        scenarioId,
      })
      setReportId(res.report.id)
      setReportType('additional')
      setActiveScenarioId(scenarioId)
      setInitialChoice('changed')
      setRawInput(def.prompt)
      await repo.patchReport({ id: res.report.id, initialStatusChoice: 'changed', rawInput: def.prompt, inputMethod: 'text' })
      setScreen('record')
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '표준상황을 시작하지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const goRecord = async (choice: InitialChoice) => {
    setInitialChoice(choice)
    if (reportId) await repo.patchReport({ id: reportId, initialStatusChoice: choice ?? undefined }).catch(() => undefined)
    if (choice === 'similar') {
      // "평소와 비슷했어요"는 자유 입력을 거치지 않고 바로 고정 질문으로 들어간다.
      setRawInput('평소와 비슷했어요')
      await startNoChangeFlow('평소와 비슷했어요')
      return
    }
    setScreen('record')
  }

  const startNoChangeFlow = async (firstText: string) => {
    const entries = classifyDomainsFromText(firstText)
    setLoading(true)
    setError(null)
    setRetryAction(null)
    try {
      if (reportId) {
        await repo.patchReport({
          id: reportId,
          initialStatusChoice: 'similar',
          noChangeInitialInput: true,
          rawInput: firstText,
          initialInformationCount: entries.length,
        })
      }
    } catch {
      // 여기서 실패하면 화면 전환·상태 갱신을 하지 않는다 — 최초 입력(firstText)은
      // 호출부(handleSubmitRaw 등)의 rawInput에 그대로 남아 있으므로, 재시도는 같은
      // 내용으로 이 함수를 다시 부르는 것뿐이라 중복 저장을 만들지 않는다.
      setError(CONNECTION_ERROR_MESSAGE)
      setRetryAction(() => () => void startNoChangeFlow(firstText))
      setLoading(false)
      return
    }
    initialNoChangeEntriesRef.current = entries
    noChangeQaHistoryRef.current = []
    noChangeRawTextsRef.current = [firstText]
    setNoChangeEntries(entries)
    setInitialInfoCount(entries.length)
    setNoChangeInitialInput(true)
    setInitialChoice('similar')
    setLoading(false)
    if (shouldSkipSecondQuestion(entries)) {
      // 확인·미확인 항목이 최초 발화에 이미 모두 있어 추가 질문 없이 바로 정리한다
      // (설계 검토 결정 D2 — 정보가 충분하면 질문 0회도 허용).
      noChangeStepsAskedRef.current = 0
      await finalizeNoChangeFlow(entries, 0, 0)
    } else if (shouldSkipFirstQuestion(entries)) {
      // 1번 질문("평소와 같았던 내용을 말씀해주세요")은 방금 한 말을 그대로
      // 되묻는 것이므로 건너뛰고 2번 질문(확인 못한 것)만 한다.
      noChangeStepsAskedRef.current = 1
      setNoChangeStep(2)
      setScreen('noChangeQuestion')
    } else {
      noChangeStepsAskedRef.current = 1
      setNoChangeStep(1)
      setScreen('noChangeQuestion')
    }
  }

  const finalizeNoChangeFlow = async (entries: DomainEntry[], askedCount: number, answeredCount: number) => {
    const report = buildNoChangeReport(entries, noChangeRawTextsRef.current)
    setLoading(true)
    setError(null)
    setRetryAction(null)
    try {
      if (reportId) {
        // "질문한 횟수"(askedCount, followup_questions와 별개 필드)와 "실제로 새로 발견한
        // 정보의 수"는 서로 다른 값이다 — computeInformationAddedCount 참고.
        const informationAddedCount = computeInformationAddedCount(initialNoChangeEntriesRef.current, entries)

        await repo.patchReport({
          id: reportId,
          aiGeneratedReport: report,
          noChangeFollowupCount: askedCount,
          noChangeFollowupAnswered: answeredCount,
          finalInformationCount: entries.length,
          informationAddedCount,
          noInformationReport: entries.length === 0,
          // changed 흐름과 동일한 필드에 실제 질문·답변 원문을 남긴다(스킵 분기처럼
          // 질문 화면 자체가 안 뜬 경우는 빈 배열 — 실제로 안 물어본 걸 물어본 것처럼
          // 기록하지 않는다).
          followupQuestions: noChangeQaHistoryRef.current,
          followupAnswers: noChangeQaHistoryRef.current,
        })
      }
      setAiGeneratedReport(report)
      setFinalReport(report)
      setScreen('reportReview')
    } catch {
      // 지금까지 답한 noChangeEntries/noChangeQaHistoryRef는 그대로 남아 있으므로
      // 재시도는 같은 내용을 다시 저장하는 것뿐이다.
      setError(CONNECTION_ERROR_MESSAGE)
      setRetryAction(() => () => void finalizeNoChangeFlow(entries, askedCount, answeredCount))
    } finally {
      setLoading(false)
    }
  }

  const handleNoChangeAnswer = async (stopRequested = false) => {
    const text = answerText.trim()
    // 이 답변에서도 응급 신호가 나올 수 있다 — 최초 발화뿐 아니라 추가답변도 검사한다.
    if (text && detectEmergencyPhrase(text)) {
      await enterEmergencyScreen(text)
      return
    }
    const newEntries = text ? mergeDomainEntries(noChangeEntries, classifyDomainsFromText(text)) : noChangeEntries
    const answered = noChangeAnswered + (text ? 1 : 0)
    if (text) {
      const questionText = noChangeStep === 1 ? NO_CHANGE_QUESTION_1 : NO_CHANGE_QUESTION_2
      noChangeQaHistoryRef.current = [
        ...noChangeQaHistoryRef.current,
        { question: questionText, missingField: 'no_change_check', answer: text },
      ]
      noChangeRawTextsRef.current = [...noChangeRawTextsRef.current, text]
    }
    setNoChangeEntries(newEntries)
    setNoChangeAnswered(answered)
    setAnswerText('')

    // "그만할게요"류 종료 의사(버튼 또는 답변 문장 안)면 남은 질문을 건너뛰고 바로
    // 정리한다 — newEntries(방금 계산한 값)를 그대로 쓴다. state(noChangeEntries)를
    // 곧바로 읽으면 아직 갱신 전 값을 볼 수 있어 로컬 변수를 직접 넘긴다.
    if (stopRequested || (text && detectStopRequest(text))) {
      await finalizeNoChangeFlow(newEntries, noChangeStepsAskedRef.current, answered)
      return
    }

    if (noChangeStep === 1 && !shouldSkipSecondQuestion(newEntries)) {
      noChangeStepsAskedRef.current += 1
      setNoChangeStep(2)
      return
    }
    await finalizeNoChangeFlow(newEntries, noChangeStepsAskedRef.current, answered)
  }

  const runAiTurn = async (history: FollowupItem[], seedInput?: string, forceFinalize = false) => {
    if (!reportId) return
    const text = seedInput ?? rawInput
    setLoading(true)
    setError(null)
    setRetryAction(null)
    try {
      await repo.patchReport({ id: reportId, rawInput: text, inputMethod, followupQuestions: history, followupAnswers: history })
      const result: AiTurnResult = await repo.aiTurn(text, history, forceFinalize)
      if (result.needFollowup && result.question) {
        setCurrentQuestion({
          question: result.question,
          missingField: result.missingField ?? 'other',
          options: result.options,
          allowMultiple: result.allowMultiple,
        })
        setAnswerText('')
        setSelectedOptions([])
        setShowFreeAnswer(false)
        setScreen('question')
      } else if (result.report) {
        setAiGeneratedReport(result.report)
        setFinalReport(result.report)
        // usedFallback을 함께 저장해 관리자 화면이 "저장됨"과 "AI가 실제로 만들었음"을
        // 구분할 수 있게 한다. 데모 모드는 result.usedFallback이 항상 undefined이므로
        // 이 필드를 건드리지 않는다(의미 없는 값을 채우지 않음).
        await repo.patchReport({
          id: reportId,
          aiGeneratedReport: result.report,
          ...(result.usedFallback !== undefined ? { aiFallbackUsed: result.usedFallback, aiFallbackStage: result.usedFallback ? 'final_report' : null } : {}),
        })
        setScreen('reportReview')
      }
    } catch {
      // 요양보호사에게는 서버 원인 문구를 그대로 보여주지 않고 항상 같은 안내로
      // 통일한다 — 최초 입력(rawInput/history)은 그대로 남아 있으므로 재시도는
      // 같은 reportId에 patch만 다시 하는 것이라 중복 보고가 생기지 않는다.
      setError(CONNECTION_ERROR_MESSAGE)
      setRetryAction(() => () => void runAiTurn(history, seedInput, forceFinalize))
    } finally {
      setLoading(false)
    }
  }

  // 응급 신호 감지 시: 나머지 절차(추가질문 등)를 건너뛰고 119/센터 연락 화면으로
  // 전환한다. draft 상태에서도 즉시 emergency_flagged를 patch해 사람이 중간에
  // 멈춰도 신호는 남게 하되, 이것 자체를 "관리자 알림 도착"으로 표현하지 않는다 —
  // 저장만 하고, 제출(submit) 전까지는 "미제출·확인 전 주의 신호"로만 다룬다.
  const enterEmergencyScreen = async (text: string) => {
    setEmergencyDraftText(text)
    if (reportId) {
      await repo.patchReport({ id: reportId, rawInput: text, inputMethod, emergencyFlagged: true }).catch(() => undefined)
    }
    setScreen('emergency')
  }

  // 119/센터 연락 버튼을 누른 것과 실제 통화·신고·조치 완료는 다른 사실이다 —
  // 여기서는 저장만 하고, 완료됐다고 단정하는 문구를 넣지 않는다.
  const handleEmergencyContinue = async () => {
    if (!reportId) return
    const text = emergencyDraftText.trim() || rawInput.trim()
    setLoading(true)
    setError(null)
    setRetryAction(null)
    try {
      const report: StructuredReport = {
        change: text || '확인되지 않음',
        action: '확인되지 않음',
        result: '확인되지 않음',
        escalation: '우선 확인 필요 — 응급 신호로 보이는 표현이 있었습니다. 119/센터 연락 여부와 현재 상태를 확인해 주세요.',
        caregiverNote: extractCaregiverNote(text),
      }
      setAiGeneratedReport(report)
      setFinalReport(report)
      await repo.patchReport({ id: reportId, rawInput: text, aiGeneratedReport: report, emergencyFlagged: true })
      setScreen('reportReview')
    } catch {
      setError(CONNECTION_ERROR_MESSAGE)
      setRetryAction(() => () => void handleEmergencyContinue())
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitRaw = () => {
    const text = rawInput.trim()
    if (!text) return
    // 제출 시점에는 마이크가 켜져 있을 이유가 없다 — 화면 이탈이므로 확실히 끈다.
    voice.cancel()
    // 응급 신호는 흐름 분기(특이사항없음/일반)보다 항상 먼저 확인한다.
    if (detectEmergencyPhrase(text)) {
      void enterEmergencyScreen(text)
      return
    }
    // "직접 말하기"로 들어왔거나(initialChoice=null) 이미 changed/uncertain을 골랐어도,
    // 실제로 "특이사항 없음" 계열 표현이면 평소와 비슷했어요 흐름으로 자동 연결한다.
    if (initialChoice !== 'changed' && initialChoice !== 'uncertain' && detectNoChangePhrase(text)) {
      void startNoChangeFlow(text)
      return
    }
    void runAiTurn(followupHistory, text)
  }

  // 선택 버튼과 자유 입력(텍스트/음성) 두 경로가 모두 여기로 모인다. answerText를
  // 화면에서 직접 조작하지 않고 항상 이 함수에 최종 답변 문자열을 넘긴다 — 어느
  // 경로로 답했든 followup_answers에는 실제로 말/선택한 내용만 그대로 남는다.
  const submitAnswerText = (text: string, stopRequested = false) => {
    if (!currentQuestion) return
    if (text && detectEmergencyPhrase(text)) {
      void enterEmergencyScreen(text)
      return
    }
    const nextHistory =
      text
        ? [...followupHistory, { question: currentQuestion.question, missingField: currentQuestion.missingField, answer: text }]
        : followupHistory
    setFollowupHistory(nextHistory)
    setCurrentQuestion(null)
    setAnswerText('')
    setSelectedOptions([])
    setShowFreeAnswer(false)
    answerVoice.cancel()
    // nextHistory(로컬 변수)를 그대로 넘긴다 — 방금 계산한 값이라 state가 아직
    // 반영 전이어도(stale closure) 문제되지 않는다. "그만할게요"류 표현이 답변
    // 문장 안에 있으면(정보는 남긴 채) 추가질문 없이 바로 정리한다.
    void runAiTurn(nextHistory, undefined, stopRequested || (text ? detectStopRequest(text) : false))
  }

  const handleAnswerQuestion = () => {
    if (!answerText.trim()) return
    submitAnswerText(answerText.trim())
  }

  /** 단일 선택 옵션 버튼 — 누르면 바로 다음 단계로 진행한다(추가 클릭 불필요). */
  const handleSelectSingleOption = (label: string) => {
    submitAnswerText(label)
  }

  const EXCLUSIVE_OPTION_HINTS = ['아직 못', '못 했', '해당 없', '없었어요', '없어요']
  const isExclusiveOption = (label: string) => EXCLUSIVE_OPTION_HINTS.some((h) => label.includes(h))

  /** 복수 선택 옵션 토글 — "아직 못 했어요"류 배타적 선택지는 다른 항목과
   * 동시에 선택되지 않게 한다(누르면 나머지를 비우고, 반대로 일반 항목을
   * 고르면 배타적 항목은 선택 해제된다). */
  const toggleMultiOption = (label: string) => {
    setSelectedOptions((prev) => {
      if (prev.includes(label)) return prev.filter((l) => l !== label)
      if (isExclusiveOption(label)) return [label]
      return [...prev.filter((l) => !isExclusiveOption(l)), label]
    })
  }

  const handleSubmitMultiOptions = () => {
    if (selectedOptions.length === 0) return
    submitAnswerText(selectedOptions.join(', '))
  }

  /** "잘 모르겠어요" — 모른다는 사실 그대로를 답으로 남긴다. 이상 없음으로
   * 바꾸거나 진행을 막지 않는다. */
  const handleUnsureAnswer = () => {
    submitAnswerText('잘 모르겠어요')
  }

  // "여기까지 말씀드릴게요" 버튼 — 답변칸이 비어있어도 동작한다(입력 강제 안 함).
  const handleStopQuestion = () => {
    const text = selectedOptions.length > 0 ? selectedOptions.join(', ') : answerText.trim()
    submitAnswerText(text, true)
  }

  const handleSubmitReport = async () => {
    if (!reportId) return
    setLoading(true)
    setError(null)
    setRetryAction(null)
    try {
      await repo.patchReport({ id: reportId, caregiverFinalReport: finalReport, submit: true })
    } catch {
      // 저장 자체가 실패했을 때만 오류·재시도를 보여준다 — 완료 화면으로 넘어가지 않는다.
      setError(CONNECTION_ERROR_MESSAGE)
      setRetryAction(() => () => void handleSubmitReport())
      setLoading(false)
      return
    }
    clearDraft()
    setScreen('submitted')
    setLoading(false)
    // 제출은 이미 성공했다 — 홈 화면 새로고침(오늘 기록 상태·목록)이 실패해도 방금
    // 제출이 성공했다는 사실과는 무관하므로, 이미 보여준 완료 화면 위에 저장
    // 실패로 오인될 수 있는 오류·재시도 UI를 덮어씌우지 않는다(다음에 홈으로
    // 돌아오면 다시 최신 상태를 불러온다).
    if (participantCode) await loadHome(participantCode, false).catch(() => undefined)
  }

  const openHistoryDetail = async (id: string) => {
    setLoading(true)
    try {
      const res = await repo.getReport(id)
      setHistoryDetail(res)
      setScreen('historyDetail')
    } catch (e) {
      setError(e instanceof ApiClientError || e instanceof Error ? e.message : '보고를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // record 화면 마이크 버튼: 듣고 있지 않으면 시작(이미 입력된 rawInput이 있으면
  // 이어서), 듣고 있거나 재연결 대기 중이면 "말하기 완료"와 동일하게 마무리한다.
  const handleVoiceToggle = () => {
    setError(null)
    if (voice.state === 'listening' || voice.state === 'reconnecting') {
      finishVoiceInput()
      return
    }
    setInputMethod('voice')
    voice.start(rawInput)
  }

  // "말하기 완료" — 마지막 인식 결과가 누락되지 않도록 정상 종료를 기다린 뒤
  // rawInput에 반영한다. 완료 후에는 같은 내용을 다시 타이핑할 필요가 없다.
  const finishVoiceInput = () => {
    voice.finish((finalText) => setRawInput(finalText))
  }

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <SpinnerIcon className="w-8 h-8 text-teal-600" />
      </div>
    )
  }
  if (phase === 'login') return <LoginScreen demo={demo} onLogin={handleLogin} />

  return (
    <Shell demo={demo} onResetDemo={handleResetDemo}>
      {screen === 'home' && (
        <div className="flex flex-col gap-5 pt-2">
          <div className="text-center">
            <p className="text-teal-600 font-bold text-lg">{participantCode}</p>
            <p className="text-slate-500 text-sm mt-0.5">{today}</p>
          </div>

          <CurrentRecipientCard
            recipientCode={recipientCode}
            recipientCodes={recipientCodes}
            showPicker={showRecipientPicker}
            onTogglePicker={() => setShowRecipientPicker((v) => !v)}
            onSelect={selectRecipient}
          />

          {/* 오늘 기록 상태는 참고 정보로 작게 보여준다 — 화면의 중심은 "이야기
              시작"이지, 아직 작성하지 않았다는 안내가 아니다. */}
          {recipientCodes.length > 0 && (
            <div
              className={`self-center flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold ${
                dailySubmitted ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {dailySubmitted && <CheckIcon className="w-4 h-4" />}
              {dailySubmitted ? '오늘 돌봄기록을 남겼어요' : '오늘 돌봄을 함께 기록해요'}
            </div>
          )}

          {error && (
            <div className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p>{error}</p>
              {retryAction && (
                <button onClick={retryAction} className="mt-2 font-bold underline">
                  다시 시도
                </button>
              )}
            </div>
          )}

          {recipientCodes.length > 0 && !dailySubmitted && (
            <div className="flex flex-col items-center gap-3 mt-1">
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-900 leading-relaxed">
                  오늘 {recipientCode} 어르신은 어떠셨어요?
                </h2>
                <p className="text-slate-500 text-base mt-1.5 leading-relaxed">
                  평소와 같아도 괜찮아요.
                  <br />
                  어르신의 상태나 돌보면서 어려웠던 점을 편하게 말씀해주세요.
                </p>
              </div>
              <button
                onClick={() => void startReport('daily')}
                disabled={loading || !recipientCode}
                aria-label="이야기 시작"
                className="w-40 h-40 rounded-full text-white flex flex-col items-center justify-center gap-2
                           bg-gradient-to-b from-teal-500 to-slate-900 shadow-xl transition
                           hover:scale-105 hover:brightness-110 active:scale-100
                           disabled:opacity-50 disabled:hover:scale-100"
              >
                <MicIcon className="w-9 h-9" />
                <span className="text-lg font-bold">{loading ? '준비 중...' : '이야기 시작'}</span>
              </button>
              <SecondaryButton
                onClick={() => void startReport('daily', false)}
                disabled={loading || !recipientCode}
                className="max-w-[240px]"
              >
                글로 입력하기
              </SecondaryButton>
              <p className="text-slate-400 text-xs text-center leading-relaxed">
                목표 시간은 60초예요. 더 걸려도 괜찮으니 편하게 말씀해주세요.
              </p>
            </div>
          )}

          {dailySubmitted && (
            <SecondaryButton onClick={() => void startReport('additional')} disabled={loading || !recipientCode}>
              추가 상태변화 기록하기
            </SecondaryButton>
          )}
          <SecondaryButton onClick={() => setScreen('history')}>내가 남긴 돌봄기록</SecondaryButton>
          {/* isDemoMode()는 현재 URL의 query만 본다 — 이 내부 이동 링크가 query 없이
              /care/scenario로만 가면 데모 모드가 풀려 일반 로그인 화면이 뜬다
              (DEP-01). 지금 데모 중일 때만 demo=1을 이어 붙인다. */}
          <a
            href={demo ? '/care/scenario?demo=1' : '/care/scenario'}
            className="text-center text-slate-400 text-xs underline mt-1"
          >
            표준상황 연습 (검증용, 실제 실증과 별도 집계)
          </a>
          <button
            onClick={() => void handleLogout()}
            className="text-slate-400 text-sm self-center mt-2 min-h-[44px] px-4 flex items-center justify-center"
          >
            로그아웃
          </button>
        </div>
      )}

      {screen === 'scenarioSelect' && (
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-xl font-bold text-slate-900 text-center">표준상황 연습</h2>
          <p className="text-slate-500 text-sm text-center leading-relaxed">
            실제 현장보고와 완전히 분리되어 집계됩니다. 참여자 1명당 2건만 수행하면 됩니다.
            <br />
            지금까지 {scenarioSubmittedCount}/2건 완료
          </p>

          <CurrentRecipientCard
            recipientCode={recipientCode}
            recipientCodes={recipientCodes}
            showPicker={showRecipientPicker}
            onTogglePicker={() => setShowRecipientPicker((v) => !v)}
            onSelect={selectRecipient}
          />

          {error && <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">{error}</p>}

          {STANDARD_SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => void startScenario(s.id)}
              disabled={loading || !recipientCode}
              className="text-left rounded-3xl bg-white border border-slate-100 shadow-sm p-5 hover:border-teal-300 transition disabled:opacity-50"
            >
              <p className="font-bold text-slate-900 mb-1">{s.title}</p>
              <p className="text-slate-500 text-sm leading-relaxed">{s.prompt}</p>
            </button>
          ))}
          <a href={demo ? '/care?demo=1' : '/care'} className="text-center text-slate-400 text-xs underline mt-1">
            실제 현장보고 화면으로 돌아가기
          </a>
        </div>
      )}

      {screen === 'statusChoice' && (
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-teal-600 font-semibold text-sm text-center">
            {REPORT_TYPE_LABEL[reportType]} 돌봄보고 · {recipientCode}
          </p>
          <h2 className="text-xl font-bold text-slate-900 text-center">오늘 방문은 어땠나요?</h2>
          <button
            onClick={() => void goRecord('changed')}
            className="w-full min-h-[64px] rounded-3xl border-2 border-teal-500 bg-teal-50 text-teal-800 text-lg font-bold px-5 hover:bg-teal-100 transition"
          >
            평소와 다른 점이 있었어요
          </button>
          <button
            onClick={() => void goRecord('similar')}
            className="w-full min-h-[64px] rounded-3xl border-2 border-slate-200 bg-white text-slate-900 text-lg font-bold px-5 hover:border-teal-400 transition"
          >
            평소와 비슷했어요
          </button>
          <button
            onClick={() => void goRecord('uncertain')}
            className="w-full min-h-[64px] rounded-3xl border-2 border-slate-200 bg-white text-slate-900 text-lg font-bold px-5 hover:border-teal-400 transition"
          >
            잘 모르겠거나 확인이 필요해요
          </button>
          <button onClick={() => void goRecord(null)} className="text-slate-400 text-sm underline self-center mt-1">
            직접 말하기
          </button>
        </div>
      )}

      {screen === 'record' && (
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-teal-600 font-semibold text-sm text-center">
            {REPORT_TYPE_LABEL[reportType]} 돌봄보고 · {recipientCode}
          </p>
          <h2 className="text-xl font-bold text-slate-900 text-center leading-relaxed">
            {activeScenarioId
              ? '아래 상황을 그대로 제출해 주세요'
              : voice.state === 'listening'
                ? '천천히 말씀하셔도 괜찮아요. 다 말씀하시면 완료를 눌러주세요.'
                : '오늘 어르신 이야기를 들려주세요'}
          </h2>

          {!activeScenarioId && (
            <div className="flex flex-col items-center gap-2">
              <button
                onClick={handleVoiceToggle}
                disabled={loading}
                className={`self-center w-32 h-32 rounded-full text-white flex flex-col items-center justify-center gap-1
                            transition disabled:opacity-50 ${
                              voice.state === 'listening'
                                ? 'bg-red-500 animate-pulse'
                                : voice.state === 'reconnecting'
                                  ? 'bg-amber-500'
                                  : 'bg-teal-600'
                            }`}
              >
                <MicIcon className="w-8 h-8" />
                <span className="text-sm font-bold">
                  {voice.state === 'listening' ? '듣고 있어요' : voice.state === 'reconnecting' ? '이어서 말하기' : '눌러서 말하기'}
                </span>
              </button>
              {voice.state === 'listening' && (
                <button onClick={finishVoiceInput} className="text-teal-700 text-sm font-bold underline">
                  말하기 완료
                </button>
              )}
              {voice.state === 'reconnecting' && (
                <p className="text-amber-600 text-sm font-bold text-center leading-relaxed">
                  마이크가 잠시 멈췄어요. 이어서 말씀해주세요.
                  <br />
                  지금까지 하신 말씀은 그대로 남아 있어요.
                </p>
              )}
            </div>
          )}

          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
            <textarea
              value={voice.state === 'listening' || voice.state === 'reconnecting' ? voice.text : rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              readOnly={voice.state === 'listening' || voice.state === 'reconnecting'}
              placeholder="음성 대신 여기에 직접 입력할 수도 있습니다. (예: 오늘 아침 식사량이 평소보다 적었어요)"
              rows={6}
              className="w-full text-lg text-slate-900 leading-relaxed focus:outline-none resize-none placeholder:text-slate-400"
            />
          </div>

          <PrivacyNotice />
          {error && (
            <div className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p>{error}</p>
              {retryAction && (
                <button onClick={retryAction} className="mt-2 font-bold underline">
                  다시 시도
                </button>
              )}
            </div>
          )}

          <PrimaryButton onClick={handleSubmitRaw} disabled={!rawInput.trim() || loading || voice.state === 'listening'}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <SpinnerIcon className="w-5 h-5" /> 말씀하신 내용을 확인하고 있어요
              </span>
            ) : (
              '이 내용으로 보고하기'
            )}
          </PrimaryButton>
          <SecondaryButton
            onClick={() => {
              voice.cancel()
              resetFlow()
            }}
            disabled={loading}
          >
            처음으로
          </SecondaryButton>
        </div>
      )}

      {screen === 'noChangeQuestion' && (
        <div className="flex flex-col gap-4 pt-2">
          {/* 이제 1번 질문을 건너뛸 수 있어 "몇 번째/총 몇 번" 표시가 항상 맞다고
              단정할 수 없다(예: 2번만 물으면 "2/2"가 되어 1번이 있었던 것처럼
              보인다) — 고정 분모 없이 "추가 확인 중"으로만 안내한다. */}
          <p className="text-teal-600 font-semibold text-sm text-center">평소와 비슷했어요 · 추가 확인 · {recipientCode}</p>
          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-6">
            <p className="text-xl font-bold text-slate-900 text-center leading-relaxed">
              {noChangeStep === 1 ? NO_CHANGE_QUESTION_1 : NO_CHANGE_QUESTION_2}
            </p>
          </div>
          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
            <textarea
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              rows={4}
              placeholder="없으면 '없어요'라고만 적어도 됩니다."
              className="w-full text-lg text-slate-900 leading-relaxed focus:outline-none resize-none placeholder:text-slate-400"
            />
          </div>
          {error && (
            <div className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p>{error}</p>
              {retryAction && (
                <button onClick={retryAction} className="mt-2 font-bold underline">
                  다시 시도
                </button>
              )}
            </div>
          )}
          <PrimaryButton onClick={() => void handleNoChangeAnswer()} disabled={loading}>
            {loading ? '말씀하신 내용을 확인하고 있어요' : '다음'}
          </PrimaryButton>
          <button
            onClick={() => void handleNoChangeAnswer(true)}
            disabled={loading}
            className="text-slate-400 text-sm underline self-center disabled:opacity-50"
          >
            여기까지 말씀드릴게요
          </button>
        </div>
      )}

      {/* screen이 'question'인 동안 currentQuestion이 잠깐 비는 구간이 실제로 있다
          (답변 제출 시 setCurrentQuestion(null)을 먼저 호출하고, 다음 질문/보고가
          비동기 AI 턴 응답으로 뒤늦게 온다 — 두 setState가 같은 렌더로 묶이지
          않는다). 이 구간에 아무 것도 렌더링하지 않으면 상단 전화 버튼과 하단
          안전고지만 남고 대화 영역 전체가 비어 보인다("흰 화면") — 반드시 로딩
          안내를 보여준다. */}
      {screen === 'question' && !currentQuestion && (
        <div className="flex flex-col items-center gap-4 pt-16 flex-1 justify-center">
          <SpinnerIcon className="w-8 h-8 text-teal-600" />
          <p className="text-slate-500 text-base">말씀하신 내용을 확인하고 있어요</p>
        </div>
      )}

      {screen === 'question' && currentQuestion && (
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-teal-600 font-semibold text-sm text-center">추가 확인 {followupHistory.length + 1}/3 · {recipientCode}</p>
          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-6">
            <p className="text-xl font-bold text-slate-900 text-center leading-relaxed">{currentQuestion.question}</p>
          </div>

          {currentQuestion.options && currentQuestion.options.length > 0 && !showFreeAnswer ? (
            <div className="flex flex-col gap-4">
              {currentQuestion.allowMultiple && (
                <p className="text-slate-400 text-xs text-center">여러 개 선택 가능</p>
              )}
              <div className="flex flex-col gap-2.5">
                {currentQuestion.options.map((opt) => {
                  const selected = currentQuestion.allowMultiple && selectedOptions.includes(opt)
                  return (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        currentQuestion.allowMultiple ? toggleMultiOption(opt) : handleSelectSingleOption(opt)
                      }
                      disabled={loading}
                      className={`min-h-[56px] rounded-3xl border-2 text-lg font-bold px-5 transition text-left disabled:opacity-50 ${
                        selected
                          ? 'border-teal-500 bg-teal-50 text-teal-800'
                          : 'border-slate-200 bg-white text-slate-900 hover:border-teal-400'
                      }`}
                    >
                      {currentQuestion.allowMultiple && (
                        <span
                          className={`inline-block w-5 h-5 mr-3 rounded-full border-2 align-middle ${
                            selected ? 'border-teal-600 bg-teal-600' : 'border-slate-300'
                          }`}
                        />
                      )}
                      {opt}
                    </button>
                  )
                })}
              </div>

              {currentQuestion.allowMultiple && (
                <PrimaryButton onClick={handleSubmitMultiOptions} disabled={selectedOptions.length === 0 || loading}>
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon className="w-5 h-5" /> 말씀하신 내용을 확인하고 있어요
                    </span>
                  ) : (
                    '다음'
                  )}
                </PrimaryButton>
              )}

              <div className="flex items-center justify-center gap-4">
                <button onClick={handleUnsureAnswer} disabled={loading} className="text-slate-400 text-sm underline disabled:opacity-50">
                  잘 모르겠어요
                </button>
                <button
                  onClick={() => setShowFreeAnswer(true)}
                  disabled={loading}
                  className="text-slate-400 text-sm underline disabled:opacity-50"
                >
                  다른 내용 말하기
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {!currentQuestion.options?.length ? null : (
                <button onClick={() => setShowFreeAnswer(false)} className="text-slate-400 text-xs underline self-center">
                  선택지로 돌아가기
                </button>
              )}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => {
                    if (answerVoice.state === 'listening' || answerVoice.state === 'reconnecting') {
                      answerVoice.finish((finalText) => setAnswerText(finalText))
                    } else {
                      answerVoice.start(answerText)
                    }
                  }}
                  disabled={loading}
                  className={`self-center w-20 h-20 rounded-full text-white flex items-center justify-center transition disabled:opacity-50 ${
                    answerVoice.state === 'listening'
                      ? 'bg-red-500 animate-pulse'
                      : answerVoice.state === 'reconnecting'
                        ? 'bg-amber-500'
                        : 'bg-teal-600'
                  }`}
                >
                  <MicIcon className="w-6 h-6" />
                </button>
                {(answerVoice.state === 'listening' || answerVoice.state === 'reconnecting') && (
                  <button
                    onClick={() => answerVoice.finish((finalText) => setAnswerText(finalText))}
                    className="text-teal-700 text-sm font-bold underline"
                  >
                    말하기 완료
                  </button>
                )}
              </div>
              <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
                <textarea
                  value={answerVoice.state === 'listening' || answerVoice.state === 'reconnecting' ? answerVoice.text : answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  readOnly={answerVoice.state === 'listening' || answerVoice.state === 'reconnecting'}
                  rows={4}
                  placeholder="답변을 입력하거나 마이크로 말씀해 주세요."
                  className="w-full text-lg text-slate-900 leading-relaxed focus:outline-none resize-none placeholder:text-slate-400"
                />
              </div>
              <PrimaryButton
                onClick={handleAnswerQuestion}
                disabled={!answerText.trim() || loading || answerVoice.state === 'listening'}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <SpinnerIcon className="w-5 h-5" /> 말씀하신 내용을 확인하고 있어요
                  </span>
                ) : (
                  '다음'
                )}
              </PrimaryButton>
            </div>
          )}

          {error && (
            <div className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p>{error}</p>
              {retryAction && (
                <button onClick={retryAction} className="mt-2 font-bold underline">
                  다시 시도
                </button>
              )}
            </div>
          )}
          <button onClick={handleStopQuestion} disabled={loading} className="text-slate-400 text-sm underline self-center disabled:opacity-50">
            여기까지 말씀드릴게요
          </button>
        </div>
      )}

      {screen === 'emergency' && (
        <div className="flex flex-col gap-4 pt-2">
          <div className="rounded-3xl bg-red-50 border-2 border-red-200 p-5 text-center">
            <p className="text-red-700 font-bold text-lg">우선 확인이 필요한 내용이 있어요</p>
            <p className="text-red-600 text-sm mt-1 leading-relaxed">
              지금 하신 말씀에 응급 상황일 수 있는 표현이 있었습니다. 필요하면 먼저 119나 센터에 연락해 주세요.
            </p>
            <p className="text-red-400 text-xs mt-2">
              이 안내는 정해진 표현을 기계적으로 찾은 것으로, 의학적 판단이 아닙니다. 실제 상황은 직접 확인해 주세요.
            </p>
          </div>
          <a
            href="tel:119"
            className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-3xl text-xl font-bold py-4 bg-red-600 text-white shadow-lg hover:bg-red-700 transition"
          >
            <PhoneIcon className="w-6 h-6" />
            119에 전화하기
          </a>
          {CENTER_PHONE && (
            <a
              href={`tel:${CENTER_PHONE}`}
              className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-3xl text-lg font-bold py-4 bg-white text-slate-900 border-2 border-slate-900 hover:bg-slate-50 transition"
            >
              <PhoneIcon className="w-5 h-5" />
              센터로 전화하기
            </a>
          )}
          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
            <label className="block font-bold text-slate-900 text-base mb-1">지금까지 하신 말씀 (필요하면 더 적어주세요)</label>
            <textarea
              value={emergencyDraftText}
              onChange={(e) => setEmergencyDraftText(e.target.value)}
              rows={5}
              className="w-full text-base text-slate-900 leading-relaxed focus:outline-none resize-none"
            />
          </div>
          {error && (
            <div className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p>{error}</p>
              {retryAction && (
                <button onClick={retryAction} className="mt-2 font-bold underline">
                  다시 시도
                </button>
              )}
            </div>
          )}
          <PrimaryButton onClick={() => void handleEmergencyContinue()} disabled={loading}>
            {loading ? '말씀하신 내용을 확인하고 있어요' : '이 내용으로 우선확인 요청 저장하기'}
          </PrimaryButton>
          <SecondaryButton onClick={resetFlow} disabled={loading}>
            취소
          </SecondaryButton>
        </div>
      )}

      {screen === 'reportReview' && (
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-teal-600 font-semibold text-sm text-center">
            {REPORT_TYPE_LABEL[reportType]} 돌봄보고 · {recipientCode} · 아직 보내지 않았어요
          </p>
          <h2 className="text-xl font-bold text-slate-900 text-center">보고 내용을 확인해 주세요</h2>
          <p className="text-slate-500 text-sm text-center">수정이 필요하면 바로 고칠 수 있습니다.</p>
          {noChangeEntries.length > 0 && (
            <p className="text-slate-400 text-xs text-center">
              확인된 영역: {noChangeEntries.map((e) => DOMAIN_LABELS[e.domain]).join(', ')}
            </p>
          )}
          {FIELD_LABELS.map(({ key, label }) => (
            <div key={key} className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
              <label className="block font-bold text-slate-900 text-base mb-1">{label}</label>
              <textarea
                value={finalReport[key]}
                onChange={(e) => setFinalReport((prev) => ({ ...prev, [key]: e.target.value }))}
                rows={3}
                className="w-full text-base text-slate-900 leading-relaxed focus:outline-none resize-none"
              />
            </div>
          ))}
          {error && (
            <div className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
              <p>{error}</p>
              {retryAction && (
                <button onClick={retryAction} className="mt-2 font-bold underline">
                  다시 시도
                </button>
              )}
            </div>
          )}
          <PrimaryButton onClick={() => void handleSubmitReport()} disabled={loading}>
            {loading ? '이대로 센터에 보내는 중이에요' : '이대로 센터에 보내기'}
          </PrimaryButton>
          <SecondaryButton onClick={resetFlow} disabled={loading}>
            취소
          </SecondaryButton>
        </div>
      )}

      {screen === 'submitted' && (
        <div className="flex flex-col items-center gap-6 pt-16 flex-1 justify-center">
          <div className="w-20 h-20 rounded-full bg-teal-600 flex items-center justify-center">
            <CheckIcon className="w-10 h-10 text-white" />
          </div>
          {!activeScenarioId && <p className="text-teal-600 font-semibold text-sm text-center">{recipientCode}</p>}
          <p className="text-2xl font-bold text-slate-900 text-center">
            {activeScenarioId
              ? '표준상황 연습이 저장되었습니다.'
              : demo
                ? '이 브라우저에 데모 기록을 저장했어요 · 실제 센터로 전송하지 않았어요.'
                : '센터에 보고되었습니다.'}
          </p>
          {/* 데모 완료 확인은 같은 Vercel origin의 /admin?demo=1로만 보낸다 —
              운영 관리자 주소로 보내면 데모 기록을 찾을 수 없다(DEP-03). */}
          {demo && !activeScenarioId && (
            <a href="/admin?demo=1" target="_blank" rel="noopener noreferrer" className="text-teal-600 text-sm underline">
              데모 관리자 화면에서 보기
            </a>
          )}
          <PrimaryButton onClick={resetFlow}>{scenarioRoute ? '표준상황 목록으로' : '홈으로'}</PrimaryButton>
        </div>
      )}

      {screen === 'history' && (
        <div className="flex flex-col gap-3 pt-2">
          <h2 className="text-xl font-bold text-slate-900 text-center">내가 남긴 돌봄기록</h2>
          {recentReports.filter((r) => r.report_source !== 'scenario').length === 0 && (
            <p className="text-slate-400 text-center py-8">아직 작성한 보고가 없습니다.</p>
          )}
          {recentReports
            .filter((r) => r.report_source !== 'scenario')
            .map((r) => (
              <button
                key={r.id}
                onClick={() => void openHistoryDetail(r.id)}
                className="text-left rounded-2xl bg-white border border-slate-100 shadow-sm p-4 hover:border-teal-300 transition"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900">
                    {r.recipient_code} · {REPORT_TYPE_LABEL[r.report_type]}
                  </span>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${r.status === 'submitted' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                    {r.status === 'submitted' ? '제출완료' : '임시저장'}
                  </span>
                </div>
                <p className="text-slate-400 text-sm mt-1">{r.report_date}</p>
              </button>
            ))}
          <SecondaryButton onClick={() => setScreen('home')}>홈으로</SecondaryButton>
        </div>
      )}

      {/* historyDetail은 draft에 저장되지 않으므로, 새로고침 직후 screen만
          'historyDetail'로 복원되고 데이터가 아직 없는 순간이 있을 수 있다 —
          question 화면과 같은 이유로 로딩 안내를 반드시 보여준다. */}
      {screen === 'historyDetail' && !historyDetail && (
        <div className="flex flex-col items-center gap-4 pt-16 flex-1 justify-center">
          <SpinnerIcon className="w-8 h-8 text-teal-600" />
          <p className="text-slate-500 text-base">불러오는 중이에요</p>
          <SecondaryButton onClick={() => setScreen('history')}>목록으로</SecondaryButton>
        </div>
      )}

      {screen === 'historyDetail' && historyDetail && (
        <div className="flex flex-col gap-4 pt-2">
          <h2 className="text-xl font-bold text-slate-900 text-center">
            {historyDetail.recipient_code} · {REPORT_TYPE_LABEL[historyDetail.report_type]} 보고
          </h2>
          <p className="text-slate-400 text-sm text-center">{historyDetail.report_date}</p>
          <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
            <p className="font-bold text-slate-900 text-base mb-1">최초 입력</p>
            <p className="text-slate-700 whitespace-pre-wrap">{historyDetail.raw_input}</p>
          </div>
          {historyDetail.caregiver_final_report &&
            FIELD_LABELS.map(({ key, label }) => (
              <div key={key} className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
                <p className="font-bold text-slate-900 text-base mb-1">{label}</p>
                <p className="text-slate-700 whitespace-pre-wrap">{historyDetail.caregiver_final_report?.[key]}</p>
              </div>
            ))}
          <SecondaryButton onClick={() => setScreen('history')}>목록으로</SecondaryButton>
        </div>
      )}
    </Shell>
  )
}

export default CareApp
