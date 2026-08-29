import { useEffect, useRef, useState } from 'react'
import { generateCareResponse, type CareResponse, type RiskLevel } from './gemini'
import {
  checkEmergency,
  mostSevereTier,
  pickQuestions,
  type QuestionChoice,
  type QuestionDef,
} from './triage'
import {
  buildCaseDraftItems,
  toDatetimeLocalValue,
  CENTER_INSTRUCTION_OPTIONS,
  FIELD_ACTION_OPTIONS,
} from './caseDraft'
import { initAnalytics, trackEvent } from './analytics'
import logo from './assets/logo.png'

type Screen = 'idle' | 'input' | 'confirm' | 'questions' | 'result' | 'callLog' | 'caseDraft'
type VoiceState = 'idle' | 'listening'

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8z"
        fill="currentColor"
      />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 12.2l1.9 1.9 3.7-3.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const RISK_STYLES: Record<RiskLevel, { bubble: string; bar: string }> = {
  '일반 관찰': {
    bubble: 'bg-green-50 text-green-800 border-green-200',
    bar: 'bg-green-500',
  },
  '기관 확인 필요': {
    bubble: 'bg-orange-50 text-orange-800 border-orange-200',
    bar: 'bg-orange-500',
  },
  '우선 확인 필요': {
    bubble: 'bg-red-50 text-red-800 border-red-200',
    bar: 'bg-red-600',
  },
}

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
const CENTER_PHONE = import.meta.env.VITE_CENTER_PHONE_NUMBER?.trim() || undefined

const CALL_BUTTON_BASE =
  'flex items-center justify-center gap-2 w-full min-h-[52px] rounded-3xl text-xl font-bold py-4 transition'

function App() {
  const [screen, setScreen] = useState<Screen>('idle')
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [situation, setSituation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CareResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [questionSet, setQuestionSet] = useState<QuestionDef[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<
    Array<{ question: string; label: string; tier: RiskLevel }>
  >([])
  const [centerCallClicked, setCenterCallClicked] = useState(false)
  const [occurredAt, setOccurredAt] = useState('')
  const [centerInstructions, setCenterInstructions] = useState<string[]>([])
  const [centerInstructionNote, setCenterInstructionNote] = useState('')
  const [fieldActions, setFieldActions] = useState<string[]>([])
  const [fieldActionNote, setFieldActionNote] = useState('')
  const [caseCopied, setCaseCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const finalTranscriptRef = useRef('')
  const settledRef = useRef(false)

  useEffect(() => {
    if (screen === 'input' || screen === 'confirm') {
      textareaRef.current?.focus()
    }
  }, [screen])

  useEffect(() => {
    initAnalytics()
  }, [])

  useEffect(() => {
    trackEvent('screen_view', { screen_name: screen })
  }, [screen])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const submitSituation = async (
    text: string,
    context?: { forcedTier?: RiskLevel; qaSummary?: string },
  ) => {
    if (!API_KEY) {
      setError(
        'AI 연결이 아직 안 되어 있어요. 프로젝트 폴더의 .env.local 파일에 VITE_GEMINI_API_KEY를 넣어주세요.',
      )
      setVoiceState('idle')
      setScreen('input')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await generateCareResponse(text, API_KEY, {
        forcedRiskLevel: context?.forcedTier,
        qaSummary: context?.qaSummary,
      })
      setResult(res)
      setScreen('result')
      trackEvent('risk_result', { risk_level: res.riskLevel })
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
      setScreen('input')
      trackEvent('analysis_error')
    } finally {
      setLoading(false)
      setVoiceState('idle')
    }
  }

  const handleVoiceButtonClick = () => {
    setError(null)

    if (voiceState === 'listening') {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setScreen('input')
      trackEvent('input_method', { method: 'manual_unsupported' })
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'ko-KR'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition
    finalTranscriptRef.current = ''
    settledRef.current = false
    setSituation('')
    setVoiceState('listening')

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += transcript
        } else {
          interim += transcript
        }
      }
      setSituation((finalTranscriptRef.current + interim).trim())
    }

    recognition.onerror = (event) => {
      if (settledRef.current) return
      settledRef.current = true
      setVoiceState('idle')
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('마이크 권한이 필요해요. 아래에서 직접 입력해 주세요.')
        setScreen('input')
      } else if (event.error === 'no-speech') {
        setError('음성이 잘 들리지 않았어요. 다시 말씀해 주세요.')
      } else if (event.error !== 'aborted') {
        setError('음성 인식에 문제가 생겼어요. 아래에서 직접 입력해 주세요.')
        setScreen('input')
      }
    }

    recognition.onend = () => {
      if (settledRef.current) return
      settledRef.current = true
      setVoiceState('idle')
      const text = finalTranscriptRef.current.trim()
      if (!text) {
        setError('음성이 잘 들리지 않았어요. 다시 말씀해 주세요.')
        return
      }
      setSituation(text)
      setScreen('confirm')
      trackEvent('input_method', { method: 'voice' })
    }

    try {
      recognition.start()
    } catch {
      settledRef.current = true
      setVoiceState('idle')
      setError('음성 인식을 시작하지 못했어요. 아래에서 직접 입력해 주세요.')
      setScreen('input')
    }
  }

  const handleReset = () => {
    recognitionRef.current?.abort()
    setSituation('')
    setResult(null)
    setError(null)
    setCopied(false)
    setVoiceState('idle')
    setQuestionSet([])
    setQuestionIndex(0)
    setAnswers([])
    setCenterCallClicked(false)
    setOccurredAt('')
    setCenterInstructions([])
    setCenterInstructionNote('')
    setFieldActions([])
    setFieldActionNote('')
    setCaseCopied(false)
    setScreen('idle')
  }

  const handleSubmit = () => {
    if (!situation.trim()) return
    const text = situation.trim()
    setError(null)

    // 데모 규칙: 명확한 응급 표현이 있으면 추가 질문 없이 바로 우선 확인 필요로 이동.
    if (checkEmergency(text)) {
      trackEvent('emergency_bypass')
      void submitSituation(text, { forcedTier: '우선 확인 필요' })
      return
    }

    setQuestionSet(pickQuestions(text))
    setQuestionIndex(0)
    setAnswers([])
    setScreen('questions')
  }

  const handleAnswerQuestion = (choice: QuestionChoice) => {
    const currentQuestion = questionSet[questionIndex]
    if (!currentQuestion) return
    const nextAnswers = [
      ...answers,
      { question: currentQuestion.text, label: choice.label, tier: choice.tier },
    ]
    setAnswers(nextAnswers)

    const nextIndex = questionIndex + 1
    if (nextIndex < questionSet.length) {
      setQuestionIndex(nextIndex)
      return
    }

    const forcedTier = mostSevereTier(nextAnswers.map((a) => a.tier))
    const qaSummary = nextAnswers.map((a) => `- ${a.question} → ${a.label}`).join('\n')
    void submitSituation(situation.trim(), { forcedTier, qaSummary })
  }

  const handlePrevQuestion = () => {
    if (questionIndex === 0) {
      setScreen('confirm')
      return
    }
    setAnswers((prev) => prev.slice(0, -1))
    setQuestionIndex((i) => i - 1)
  }

  const handleCopy = async () => {
    if (!result) return
    const text = [
      `위험도: ${result.riskLevel}`,
      `지금 할 일: ${result.immediateAction}`,
      `확인할 내용: ${result.checks.join(', ')}`,
      `센터 보고 예시: ${result.reportSentence}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      trackEvent('copy_result')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('복사에 실패했습니다. 내용을 직접 선택해 복사해 주세요.')
    }
  }

  const handleGoToCallLog = () => {
    setOccurredAt(toDatetimeLocalValue(new Date()))
    setScreen('callLog')
  }

  const toggleInList = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item])
  }

  const caseDraftItems =
    result != null
      ? buildCaseDraftItems({
          occurredAt,
          situation,
          answers,
          result,
          centerCallClicked,
          centerInstructions,
          centerInstructionNote,
          fieldActions,
          fieldActionNote,
        })
      : []

  const handleCopyCaseDraft = async () => {
    const text = ['현장 대응 기록 초안', '', ...caseDraftItems.map((i) => `${i.label}: ${i.value}`)]
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCaseCopied(true)
      setError(null)
      trackEvent('copy_case_draft')
      setTimeout(() => setCaseCopied(false), 4000)
    } catch {
      setError('복사에 실패했습니다. 내용을 직접 선택해 복사해 주세요.')
    }
  }

  const isUrgent = result?.riskLevel === '우선 확인 필요'
  const showCenterCall =
    result?.riskLevel === '우선 확인 필요' || result?.riskLevel === '기관 확인 필요'
  const centerCallIsPrimary = result?.riskLevel === '기관 확인 필요'
  const isListening = voiceState === 'listening'

  return (
    <div
      className={`relative min-h-screen bg-slate-50 flex flex-col items-center px-4 py-10 overflow-hidden
                  ${screen === 'idle' ? 'justify-center' : ''}`}
    >
      <header className="relative mb-8 text-center">
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute -top-6 left-1/2 -translate-x-1/2
                     -z-10 w-64 opacity-[0.06]"
        />
        <p className="text-base font-semibold tracking-wide text-teal-600">
          AI365 CARE DREAM
        </p>
        <h1 className="text-3xl font-bold text-slate-900 mt-1">
          현장 대응 도우미
        </h1>
      </header>

      <main className="relative w-full max-w-md">
        {screen === 'idle' && (
          <div className="flex flex-col items-center justify-center gap-8">
            <button
              onClick={handleVoiceButtonClick}
              aria-label="상황 말하기 시작"
              className="relative w-64 h-64 rounded-full text-white text-2xl font-bold
                         flex flex-col items-center justify-center text-center leading-snug gap-2
                         bg-gradient-to-b from-teal-500 to-slate-900 shadow-xl
                         hover:scale-105 hover:brightness-110 active:scale-100 transition
                         focus:outline-none focus:ring-4 focus:ring-teal-300
                         disabled:cursor-default"
            >
              {isListening && (
                <>
                  <span className="absolute -inset-2 rounded-full border-4 border-teal-300/70 animate-ping" />
                  <span
                    className="absolute -inset-6 rounded-full border-4 border-teal-200/40 animate-ping"
                    style={{ animationDelay: '0.3s' }}
                  />
                </>
              )}
              {!isListening && (
                <span className="absolute -inset-3 rounded-full border-4 border-teal-200/60 animate-pulse" />
              )}

              <MicIcon className={`w-10 h-10 ${isListening ? 'animate-pulse' : ''}`} />

              {voiceState === 'idle' && (
                <span>
                  눌러서
                  <br />
                  상황 말하기
                </span>
              )}
              {isListening && <span>듣고 있어요</span>}

              <span className="sr-only" aria-live="polite">
                {isListening ? '듣고 있어요' : ''}
              </span>
            </button>

            {voiceState !== 'idle' && (
              <div className="w-full rounded-3xl bg-white border border-slate-100 shadow-sm p-4 min-h-16">
                <p className="text-slate-700 text-lg leading-relaxed">
                  {situation || (
                    <span className="text-slate-400">말씀해 주세요...</span>
                  )}
                </p>
              </div>
            )}

            {voiceState === 'idle' && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-slate-500 text-lg text-center leading-relaxed">
                  버튼을 누르고 현재 상황을 말씀해 주세요.
                  <br />
                  AI가 지금 필요한 대응을 안내해 드립니다.
                </p>
                <p className="flex items-center gap-1.5 text-slate-400 text-sm">
                  <ShieldIcon className="w-4 h-4 shrink-0" />
                  성명·주소 등 개인정보는 말하지 마세요.
                </p>
              </div>
            )}

            {error && (
              <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                {error}
              </p>
            )}
          </div>
        )}

        {screen === 'input' && (
          <div className="flex flex-col gap-5 pt-6">
            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <textarea
                ref={textareaRef}
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                placeholder="평소 말하듯 편하게 적어주세요. (예: 어르신이 오늘 아침부터 어지럽다고 하시고 걸을 때 휘청거립니다)"
                rows={7}
                className="w-full text-lg text-slate-900 leading-relaxed
                           focus:outline-none resize-none placeholder:text-slate-400"
              />
            </div>
            {error && (
              <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
                {error}
              </p>
            )}
            <button
              onClick={handleSubmit}
              disabled={!situation.trim() || loading}
              className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-full
                         bg-teal-600 text-white text-xl font-bold py-4
                         hover:bg-teal-700 transition disabled:bg-slate-300
                         disabled:cursor-not-allowed"
            >
              {loading && <SpinnerIcon className="w-5 h-5" />}
              {loading ? '분석하는 중...' : '대응안 만들기'}
            </button>
            <button
              onClick={handleReset}
              className="text-slate-400 text-base hover:text-slate-600 transition self-center"
            >
              처음으로
            </button>
          </div>
        )}

        {screen === 'confirm' && (
          <div className="flex flex-col gap-5 pt-6">
            <h2 className="text-2xl font-bold text-slate-900 text-center">
              말씀하신 내용을 확인해 주세요
            </h2>
            <p className="text-slate-500 text-lg text-center leading-relaxed">
              AI가 이렇게 들었어요. 잘못 인식된 내용이 있으면 수정해 주세요.
            </p>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <textarea
                ref={textareaRef}
                value={situation}
                onChange={(e) => setSituation(e.target.value)}
                rows={7}
                className="w-full text-xl text-slate-900 leading-relaxed
                           focus:outline-none resize-none placeholder:text-slate-400"
              />
            </div>

            <p className="flex items-center gap-1.5 text-slate-400 text-sm justify-center text-center">
              <ShieldIcon className="w-4 h-4 shrink-0" />
              성명·주소·전화번호 등 개인정보가 포함되지 않았는지 확인해 주세요.
            </p>

            {error && (
              <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
                {error}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={!situation.trim() || loading}
              className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-full
                         bg-teal-600 text-white text-xl font-bold py-4
                         hover:bg-teal-700 transition disabled:bg-slate-300
                         disabled:cursor-not-allowed"
            >
              {loading && <SpinnerIcon className="w-5 h-5" />}
              {loading ? '분석하는 중...' : '이 내용으로 확인하기'}
            </button>
            <button
              onClick={handleReset}
              className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white
                         text-slate-700 text-xl font-bold py-4 hover:bg-slate-50 transition"
            >
              다시 말하기
            </button>
          </div>
        )}

        {screen === 'questions' && questionSet[questionIndex] && (
          <div className="flex flex-col gap-5 pt-6">
            <h2 className="text-2xl font-bold text-slate-900 text-center">
              몇 가지만 더 확인할게요
            </h2>
            <p className="text-slate-500 text-lg text-center leading-relaxed">
              정확한 안내를 위해 현재 상태를 확인해 주세요.
            </p>
            <p className="text-teal-600 font-semibold text-sm text-center tracking-wide">
              추가 확인 {questionIndex + 1}/{questionSet.length}
            </p>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-6">
              <p className="text-2xl font-bold text-slate-900 text-center leading-relaxed">
                {questionSet[questionIndex].text}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {questionSet[questionIndex].choices.map((choice) => (
                <button
                  key={choice.label}
                  onClick={() => handleAnswerQuestion(choice)}
                  disabled={loading}
                  className="w-full min-h-[52px] rounded-3xl border-2 border-slate-200 bg-white
                             text-slate-900 text-xl font-bold py-4
                             hover:border-teal-500 hover:bg-teal-50 transition
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {choice.label}
                </button>
              ))}
            </div>

            {loading && (
              <p className="flex items-center justify-center gap-2 text-slate-500 text-base">
                <SpinnerIcon className="w-5 h-5" />
                분석하는 중...
              </p>
            )}

            {error && (
              <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4">
                {error}
              </p>
            )}

            <button
              onClick={handlePrevQuestion}
              disabled={loading}
              className="text-slate-400 text-base hover:text-slate-600 transition self-center
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              이전 질문으로
            </button>
          </div>
        )}

        {screen === 'result' && result && (
          <div className="flex flex-col gap-4 pt-4">
            {isUrgent && (
              <a
                href="tel:119"
                aria-label="119에 전화하기"
                onClick={() => trackEvent('call_button_click', { type: '119' })}
                className={`${CALL_BUTTON_BASE} bg-red-600 text-white shadow-lg hover:bg-red-700`}
              >
                <PhoneIcon className="w-6 h-6" />
                지금 119에 전화하기
              </a>
            )}

            {showCenterCall &&
              (CENTER_PHONE ? (
                <a
                  href={`tel:${CENTER_PHONE}`}
                  aria-label="센터에 전화하기"
                  onClick={() => {
                    setCenterCallClicked(true)
                    trackEvent('call_button_click', { type: 'center' })
                  }}
                  className={
                    centerCallIsPrimary
                      ? `${CALL_BUTTON_BASE} bg-slate-900 text-white shadow-lg hover:bg-slate-800`
                      : `${CALL_BUTTON_BASE} bg-white text-slate-900 border-2 border-slate-900 hover:bg-slate-50`
                  }
                >
                  <PhoneIcon className="w-6 h-6" />
                  센터로 전화하기
                </a>
              ) : (
                <p className="text-center text-slate-400 text-sm">
                  센터 전화번호가 등록되지 않았습니다.
                </p>
              ))}

            <div
              className={`rounded-3xl rounded-tl-lg border px-5 py-4 text-xl font-bold
                          ${RISK_STYLES[result.riskLevel].bubble}`}
            >
              <span
                className={`inline-block w-3 h-3 rounded-full mr-2 align-middle ${RISK_STYLES[result.riskLevel].bar}`}
              />
              {result.riskLevel}
            </div>

            <div className="rounded-3xl rounded-tl-lg bg-white border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-900 text-lg mb-2">지금 할 일</h2>
              <p className="text-slate-700 text-lg leading-relaxed">
                {result.immediateAction}
              </p>
            </div>

            <div className="rounded-3xl rounded-tl-lg bg-white border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-900 text-lg mb-2">확인할 내용</h2>
              <ul className="text-slate-700 text-lg leading-relaxed space-y-1 list-disc list-inside">
                {result.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl rounded-tl-lg bg-teal-50 border border-teal-100 p-5">
              <h2 className="font-bold text-slate-900 text-lg mb-2">센터 보고 예시</h2>
              <p className="text-slate-700 text-lg leading-relaxed">
                {result.reportSentence}
              </p>
            </div>

            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={handleGoToCallLog}
                className={
                  centerCallIsPrimary
                    ? 'w-full min-h-[52px] rounded-full border-2 border-slate-900 bg-white text-slate-900 text-xl font-bold py-4 hover:bg-slate-50 transition'
                    : 'w-full min-h-[52px] rounded-full bg-slate-900 text-white text-xl font-bold py-4 hover:bg-slate-800 transition'
                }
              >
                {result.riskLevel === '일반 관찰' ? '현장 대응 기록하기' : '센터 통화 후 기록하기'}
              </button>
              <button
                onClick={handleCopy}
                className="w-full rounded-full bg-slate-900 text-white text-xl font-bold py-4
                           hover:bg-slate-800 transition"
              >
                {copied ? '복사됨!' : '결과 복사'}
              </button>
              <button
                onClick={handleReset}
                className="w-full rounded-full border border-slate-300 bg-white text-slate-700
                           text-xl font-bold py-4 hover:bg-slate-50 transition"
              >
                다시 말하기
              </button>
            </div>
          </div>
        )}

        {screen === 'callLog' && (
          <div className="flex flex-col gap-5 pt-6">
            <h2 className="text-2xl font-bold text-slate-900 text-center">
              통화 내용을 정리해 주세요
            </h2>
            <p className="text-slate-500 text-lg text-center leading-relaxed">
              센터에서 안내받은 내용을 선택하거나 직접 입력해 주세요.
            </p>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <label className="block font-bold text-slate-900 text-lg mb-2">발생 일시</label>
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full text-lg text-slate-900 border border-slate-200 rounded-xl p-3
                           focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="flex flex-col gap-3">
              {CENTER_INSTRUCTION_OPTIONS.map((opt) => {
                const selected = centerInstructions.includes(opt)
                return (
                  <button
                    key={opt}
                    onClick={() => toggleInList(centerInstructions, setCenterInstructions, opt)}
                    aria-pressed={selected}
                    className={`flex items-center justify-between gap-2 w-full min-h-[52px]
                                rounded-3xl border-2 text-lg font-bold py-4 px-5 transition
                                ${
                                  selected
                                    ? 'bg-teal-600 border-teal-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-900 hover:border-teal-500 hover:bg-teal-50'
                                }`}
                  >
                    <span>{opt}</span>
                    {selected && <CheckIcon className="w-5 h-5 shrink-0" />}
                  </button>
                )
              })}
            </div>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <label className="block font-bold text-slate-900 text-lg mb-2">센터 지시사항</label>
              <textarea
                value={centerInstructionNote}
                onChange={(e) => setCenterInstructionNote(e.target.value)}
                placeholder="센터에서 안내받은 내용을 입력해 주세요."
                rows={4}
                className="w-full text-lg text-slate-900 leading-relaxed
                           focus:outline-none resize-none placeholder:text-slate-400"
              />
            </div>

            <h2 className="text-2xl font-bold text-slate-900 text-center mt-2">
              현재 어떤 조치를 했나요?
            </h2>

            <div className="flex flex-col gap-3">
              {FIELD_ACTION_OPTIONS.map((opt) => {
                const selected = fieldActions.includes(opt)
                return (
                  <button
                    key={opt}
                    onClick={() => toggleInList(fieldActions, setFieldActions, opt)}
                    aria-pressed={selected}
                    className={`flex items-center justify-between gap-2 w-full min-h-[52px]
                                rounded-3xl border-2 text-lg font-bold py-4 px-5 transition
                                ${
                                  selected
                                    ? 'bg-teal-600 border-teal-600 text-white'
                                    : 'bg-white border-slate-200 text-slate-900 hover:border-teal-500 hover:bg-teal-50'
                                }`}
                  >
                    <span>{opt}</span>
                    {selected && <CheckIcon className="w-5 h-5 shrink-0" />}
                  </button>
                )
              })}
            </div>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <label className="block font-bold text-slate-900 text-lg mb-2">
                추가로 기록할 내용
              </label>
              <textarea
                value={fieldActionNote}
                onChange={(e) => setFieldActionNote(e.target.value)}
                rows={4}
                className="w-full text-lg text-slate-900 leading-relaxed
                           focus:outline-none resize-none placeholder:text-slate-400"
              />
            </div>

            <button
              onClick={() => setScreen('caseDraft')}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl
                         font-bold py-4 hover:bg-teal-700 transition"
            >
              기록 초안 만들기
            </button>
            <button
              onClick={() => setScreen('result')}
              className="text-slate-400 text-base hover:text-slate-600 transition self-center"
            >
              결과 화면으로 돌아가기
            </button>
          </div>
        )}

        {screen === 'caseDraft' && (
          <div className="flex flex-col gap-4 pt-6">
            <h2 className="text-2xl font-bold text-slate-900 text-center">
              현장 대응 기록 초안
            </h2>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-4">
              {caseDraftItems.map((item) => (
                <div key={item.label}>
                  <p className="font-bold text-slate-900 text-base mb-1">{item.label}</p>
                  <p className="text-slate-700 text-lg leading-relaxed whitespace-pre-wrap">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            {caseCopied && (
              <p className="text-base text-teal-700 bg-teal-50 border border-teal-100 rounded-2xl p-4 text-center">
                기록 초안이 복사되었습니다. 기관 기록에 사용하기 전 내용을 다시 확인해 주세요.
              </p>
            )}

            {error && (
              <p className="text-base text-red-700 bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={handleCopyCaseDraft}
                className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl
                           font-bold py-4 hover:bg-teal-700 transition"
              >
                기록 초안 복사
              </button>
              <button
                onClick={() => setScreen('callLog')}
                className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white
                           text-slate-700 text-xl font-bold py-4 hover:bg-slate-50 transition"
              >
                내용 수정하기
              </button>
              <button
                onClick={handleReset}
                className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white
                           text-slate-700 text-xl font-bold py-4 hover:bg-slate-50 transition"
              >
                새로운 상황 말하기
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
