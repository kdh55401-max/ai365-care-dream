import { useEffect, useRef, useState, type RefObject } from 'react'
import { navigate } from '../router'
import logo from '../assets/logo.png'
import {
  PHOTO_PRIVACY_NOTICE,
  SAFETY_SCANNER_PROTOCOL,
} from './protocol'
import { assessRisk, EMERGENCY_GUIDANCE, RISK_LEVEL_META } from './riskRules'
import { buildFollowUpActions, IMMEDIATE_ACTION_OPTIONS } from './resourceSuggestions'
import { useVoiceInput } from './useVoiceInput'
import { AREA_LABELS } from './types'
import type {
  EvidencePhoto,
  Observation,
  ProtocolOption,
  RiskAssessment,
  SafetyArea,
  ScanMessage,
  ScanResult,
} from './types'
import { AlertIcon, BackIcon, CameraIcon, CheckIcon, MicIcon, ShieldIcon } from './icons'

type ScannerScreen = 'start' | 'chat' | 'confirmAbort' | 'emergency' | 'actions' | 'result'

const DEMO_SUBJECT_NAME = '테스트 어르신'
const SCAN_TYPE_LABEL = '방문 기본스캔'
const AREA_ORDER: SafetyArea[] = ['mobility', 'gasFire', 'electrical']

interface HistoryEntry {
  stepIndex: number
  messagesLen: number
  observationsLen: number
  signalIdsLen: number
  evidencePhotosLen: number
  freeNotesLen: number
}

function formatDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function findNextStepIndex(fromIndex: number, signalIds: string[]): number {
  for (let i = fromIndex; i < SAFETY_SCANNER_PROTOCOL.length; i++) {
    const step = SAFETY_SCANNER_PROTOCOL[i]
    if (!step.askIf || step.askIf(signalIds)) return i
  }
  return SAFETY_SCANNER_PROTOCOL.length
}

let messageSeq = 0
function nextMessageId() {
  messageSeq += 1
  return `msg_${messageSeq}`
}

function SafetyScannerApp() {
  const [screen, setScreen] = useState<ScannerScreen>('start')
  const [stepIndex, setStepIndex] = useState(0)
  const [messages, setMessages] = useState<ScanMessage[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [signalIds, setSignalIds] = useState<string[]>([])
  const [evidencePhotos, setEvidencePhotos] = useState<EvidencePhoto[]>([])
  const [freeNotes, setFreeNotes] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [emergencyArea, setEmergencyArea] = useState<SafetyArea | null>(null)
  const [actionSelected, setActionSelected] = useState<string[]>([])
  const [actionNote, setActionNote] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [resultFinalized, setResultFinalized] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const voice = useVoiceInput()

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, screen])

  const currentStep = SAFETY_SCANNER_PROTOCOL[stepIndex]
  const assessment: RiskAssessment = assessRisk(signalIds)

  const resetAll = () => {
    setStepIndex(0)
    setMessages([])
    setObservations([])
    setSignalIds([])
    setEvidencePhotos([])
    setFreeNotes([])
    setHistory([])
    setMultiSelected([])
    setNoteDraft('')
    setEmergencyArea(null)
    setActionSelected([])
    setActionNote('')
    setResult(null)
    setResultFinalized(false)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
  }

  const startScan = () => {
    resetAll()
    const firstIndex = findNextStepIndex(0, [])
    const firstStep = SAFETY_SCANNER_PROTOCOL[firstIndex]
    setStepIndex(firstIndex)
    if (firstStep) {
      setMessages([{ id: nextMessageId(), role: 'ai', text: firstStep.prompt }])
    }
    setScreen('chat')
  }

  const pushHistorySnapshot = () => {
    setHistory((prev) => [
      ...prev,
      {
        stepIndex,
        messagesLen: messages.length,
        observationsLen: observations.length,
        signalIdsLen: signalIds.length,
        evidencePhotosLen: evidencePhotos.length,
        freeNotesLen: freeNotes.length,
      },
    ])
  }

  const goToStepIndex = (index: number) => {
    const step = SAFETY_SCANNER_PROTOCOL[index]
    if (!step) return
    setStepIndex(index)
    setMultiSelected([])
    setNoteDraft('')
    setPhotoPreview(null)
    setMessages((prev) => [...prev, { id: nextMessageId(), role: 'ai', text: step.prompt }])
  }

  const finishAreaOrEmergency = (
    updatedSignalIds: string[],
    fromStepArea: SafetyArea,
    fromIndex: number,
    updatedObservations: Observation[],
    updatedPhotos: EvidencePhoto[],
    updatedNotes: string[],
  ) => {
    const nextAssessment = assessRisk(updatedSignalIds)

    // 가스·화재 의심은 즉시 전체 점검을 중단한다(사진 촬영 없이 곧바로 긴급안내).
    if (updatedSignalIds.includes('gas_emergency')) {
      setEmergencyArea('gasFire')
      setScreen('emergency')
      return
    }

    const nextIndex = findNextStepIndex(fromIndex + 1, updatedSignalIds)
    const nextStep = SAFETY_SCANNER_PROTOCOL[nextIndex]

    // 전기 우선확인 신호는 "문제 부분만" 사진으로 남기는 절차가 남아 있으면
    // 긴급안내보다 그 사진 단계를 먼저 보여준다. 그 외 긴급 신호는 즉시 중단한다.
    const shouldCapturePhotoBeforeEmergency =
      nextAssessment.isEmergency && fromStepArea === 'electrical' && nextStep?.kind === 'photo'

    if (nextAssessment.isEmergency && !shouldCapturePhotoBeforeEmergency) {
      const emergencySignal = nextAssessment.signals.find((s) => s.emergency)
      setEmergencyArea(emergencySignal?.area ?? fromStepArea)
      setScreen('emergency')
      return
    }

    if (nextIndex >= SAFETY_SCANNER_PROTOCOL.length) {
      if (nextAssessment.level === 'LEVEL1') {
        setResult(buildResult(nextAssessment, updatedObservations, updatedPhotos, updatedNotes))
        setScreen('result')
      } else {
        setScreen('actions')
      }
      return
    }
    goToStepIndex(nextIndex)
  }

  const buildResult = (
    finalAssessment: RiskAssessment,
    finalObservations: Observation[],
    finalPhotos: EvidencePhoto[],
    finalNotes: string[],
    finalAction?: { selected: string[]; customText: string },
  ): ScanResult => {
    const areasChecked = AREA_ORDER.filter((area) =>
      finalObservations.some((o) => o.area === area),
    )
    const meta = RISK_LEVEL_META[finalAssessment.level]
    const observationSummary = AREA_ORDER.filter((a) => areasChecked.includes(a)).map((area) => {
      const items = finalObservations
        .filter((o) => o.area === area)
        .map((o) => o.answerLabel)
        .join(', ')
      return `${AREA_LABELS[area]}: ${items || '특이사항 없음'}`
    })
    return {
      performedAt: formatDateTime(new Date()),
      scanType: SCAN_TYPE_LABEL,
      demoSubjectName: DEMO_SUBJECT_NAME,
      areasChecked,
      observationSummary,
      subjectQuotes: finalNotes,
      observations: finalObservations,
      evidencePhotos: finalPhotos,
      riskAssessment: finalAssessment,
      immediateAction: {
        selected: finalAction?.selected ?? [],
        customText: finalAction?.customText ?? '',
      },
      institutionCheckNotes: finalAssessment.level === 'LEVEL1' ? [] : meta.actions,
      followUpActions: buildFollowUpActions(finalAssessment),
      nextVisitChecks:
        finalAssessment.signals.length > 0
          ? finalAssessment.signals.map((s) => s.label)
          : ['다음 방문에서 일반 관찰'],
      status: meta.processingStatus,
    }
  }

  const commitAnswer = (
    step: (typeof SAFETY_SCANNER_PROTOCOL)[number],
    chosenOptions: ProtocolOption[],
  ) => {
    if (step.kind !== 'question') return
    pushHistorySnapshot()
    const newSignals = chosenOptions
      .map((o) => o.signalId)
      .filter((id): id is string => Boolean(id))
    const answerLabel = chosenOptions.map((o) => o.label).join(', ')
    const noteSuffix = noteDraft.trim() ? ` (메모: ${noteDraft.trim()})` : ''

    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: 'user', text: answerLabel + noteSuffix },
    ])
    const observation: Observation = {
      id: nextMessageId(),
      area: step.area,
      question: step.prompt,
      answerLabel,
      signalIds: newSignals,
    }
    const updatedObservations = [...observations, observation]
    setObservations(updatedObservations)

    const updatedSignalIds = [...signalIds, ...newSignals]
    setSignalIds(updatedSignalIds)

    const updatedNotes = noteDraft.trim() ? [...freeNotes, noteDraft.trim()] : freeNotes
    if (noteDraft.trim()) {
      setFreeNotes(updatedNotes)
    }
    setNoteDraft('')
    setMultiSelected([])

    finishAreaOrEmergency(updatedSignalIds, step.area, stepIndex, updatedObservations, evidencePhotos, updatedNotes)
  }

  const handleSingleAnswer = (option: ProtocolOption) => {
    if (currentStep?.kind !== 'question') return
    commitAnswer(currentStep, [option])
  }

  const toggleMultiOption = (option: ProtocolOption) => {
    const exclusive = option.signalId === null || option.signalId?.endsWith('_none') || option.signalId?.endsWith('_unknown')
    setMultiSelected((prev) => {
      if (exclusive) {
        return prev.includes(option.id) ? [] : [option.id]
      }
      const withoutExclusive = prev.filter((id) => {
        const opt = currentStep && currentStep.kind === 'question' ? currentStep.options.find((o) => o.id === id) : undefined
        const isExclusive = opt && (opt.signalId === null || opt.signalId?.endsWith('_none') || opt.signalId?.endsWith('_unknown'))
        return !isExclusive
      })
      return withoutExclusive.includes(option.id)
        ? withoutExclusive.filter((id) => id !== option.id)
        : [...withoutExclusive, option.id]
    })
  }

  const submitMultiAnswer = () => {
    if (currentStep?.kind !== 'question') return
    const chosen = currentStep.options.filter((o) => multiSelected.includes(o.id))
    if (chosen.length === 0) return
    commitAnswer(currentStep, chosen)
  }

  const handlePhotoFile = (file: File) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const proceedFromPhotoStep = (attached: boolean) => {
    if (currentStep?.kind !== 'photo') return
    pushHistorySnapshot()
    let updatedPhotos = evidencePhotos
    let updatedMessages = messages
    if (attached && photoPreview) {
      const areaLabel = AREA_LABELS[currentStep.area]
      const photo: EvidencePhoto = {
        id: nextMessageId(),
        area: currentStep.area,
        areaLabel,
        previewUrl: photoPreview,
        capturedAt: formatDateTime(new Date()),
      }
      updatedPhotos = [...evidencePhotos, photo]
      updatedMessages = [
        ...messages,
        { id: nextMessageId(), role: 'user', text: `현장사진 첨부됨 (촬영영역: ${areaLabel})` },
      ]
      setEvidencePhotos(updatedPhotos)
      setMessages(updatedMessages)
    } else {
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      updatedMessages = [...messages, { id: nextMessageId(), role: 'user', text: '사진 촬영을 건너뜀' }]
      setMessages(updatedMessages)
    }
    setPhotoPreview(null)
    finishAreaOrEmergency(signalIds, currentStep.area, stepIndex, observations, updatedPhotos, freeNotes)
  }

  const goToPreviousQuestion = () => {
    if (history.length === 0) {
      setScreen('start')
      return
    }
    const last = history[history.length - 1]
    setHistory((prev) => prev.slice(0, -1))
    setStepIndex(last.stepIndex)
    setMessages((prev) => prev.slice(0, last.messagesLen))
    setObservations((prev) => prev.slice(0, last.observationsLen))
    setSignalIds((prev) => prev.slice(0, last.signalIdsLen))
    setEvidencePhotos((prev) => prev.slice(0, last.evidencePhotosLen))
    setFreeNotes((prev) => prev.slice(0, last.freeNotesLen))
    setMultiSelected([])
    setNoteDraft('')
  }

  const confirmAbort = () => {
    resetAll()
    setScreen('start')
  }

  const proceedFromEmergency = () => {
    setScreen('actions')
  }

  const toggleActionOption = (opt: string) => {
    setActionSelected((prev) => (prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]))
  }

  const finishActions = () => {
    const finalAssessment = assessRisk(signalIds)
    setResult(
      buildResult(finalAssessment, observations, evidencePhotos, freeNotes, {
        selected: actionSelected,
        customText: actionNote,
      }),
    )
    setScreen('result')
  }

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8">
      <header className="relative mb-6 text-center w-full max-w-md">
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute -top-6 left-1/2 -translate-x-1/2 -z-10 w-56 opacity-[0.06]"
        />
        <button
          onClick={() => navigate('/')}
          className="absolute left-0 top-0 flex items-center gap-1 text-slate-400 hover:text-slate-600 text-sm py-1 px-1"
          aria-label="AI365 CARE DREAM 홈으로"
        >
          <BackIcon className="w-5 h-5" />
          <span>홈</span>
        </button>
        <p className="text-base font-semibold tracking-wide text-teal-600">AI365 생활안전스캐너</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">생활안전 점검</h1>
      </header>

      <main className="relative w-full max-w-md flex-1">
        {screen === 'start' && (
          <StartScreen onStart={startScan} onBack={() => navigate('/')} />
        )}

        {screen === 'chat' && currentStep && (
          <ChatScreen
            step={currentStep}
            stepIndex={stepIndex}
            messages={messages}
            multiSelected={multiSelected}
            noteDraft={noteDraft}
            onNoteDraftChange={setNoteDraft}
            voice={voice}
            photoPreview={photoPreview}
            fileInputRef={fileInputRef}
            onPickPhotoFile={handlePhotoFile}
            onSingleAnswer={handleSingleAnswer}
            onToggleMulti={toggleMultiOption}
            onSubmitMulti={submitMultiAnswer}
            onPhotoNext={() => proceedFromPhotoStep(true)}
            onPhotoSkip={() => proceedFromPhotoStep(false)}
            onPrevQuestion={goToPreviousQuestion}
            onAbortRequest={() => setScreen('confirmAbort')}
            transcriptEndRef={transcriptEndRef}
          />
        )}

        {screen === 'confirmAbort' && (
          <div className="flex flex-col gap-5 pt-10">
            <h2 className="text-xl font-bold text-slate-900 text-center">점검을 중단할까요?</h2>
            <p className="text-slate-500 text-lg text-center leading-relaxed">
              지금까지 확인한 내용은 저장되지 않습니다.
            </p>
            <button
              onClick={confirmAbort}
              className="w-full min-h-[52px] rounded-full border-2 border-red-500 text-red-600 bg-white text-xl font-bold py-4 hover:bg-red-50 transition"
            >
              중단하고 처음으로
            </button>
            <button
              onClick={() => setScreen('chat')}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition"
            >
              점검 계속하기
            </button>
          </div>
        )}

        {screen === 'emergency' && emergencyArea && (
          <EmergencyScreen area={emergencyArea} onProceed={proceedFromEmergency} />
        )}

        {screen === 'actions' && (
          <ActionsScreen
            assessment={assessment}
            selected={actionSelected}
            note={actionNote}
            onToggle={toggleActionOption}
            onNoteChange={setActionNote}
            onFinish={finishActions}
          />
        )}

        {screen === 'result' && result && (
          <ResultScreen
            result={result}
            finalized={resultFinalized}
            onFinalize={() => setResultFinalized(true)}
            onEdit={() => setScreen('actions')}
            onHome={() => navigate('/')}
            onNewScan={startScan}
          />
        )}
      </main>
    </div>
  )
}

function StartScreen({ onStart, onBack }: { onStart: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-5 pt-4">
      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-6 flex flex-col gap-2">
        <p className="text-teal-600 font-bold text-sm tracking-wide">AI365 생활안전스캐너</p>
        <h2 className="text-2xl font-bold text-slate-900">방문 기본스캔</h2>
        <p className="text-slate-500 text-lg">예상 소요시간 2~3분</p>
        <p className="text-slate-500 text-base mt-2">데모 대상자: 테스트 어르신</p>
        <div className="flex items-start gap-2 mt-3 bg-teal-50 border border-teal-100 rounded-2xl p-3">
          <ShieldIcon className="w-5 h-5 shrink-0 text-teal-600 mt-0.5" />
          <p className="text-slate-600 text-sm leading-relaxed">
            실제 개인정보를 입력하지 않는 실증용 화면입니다.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4 flex items-center justify-between opacity-60">
          <span className="text-slate-500 text-lg font-bold">월간 정밀스캔</span>
          <span className="text-slate-400 text-sm font-semibold">준비 중</span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4 flex items-center justify-between opacity-60">
          <span className="text-slate-500 text-lg font-bold">계절·상황스캔</span>
          <span className="text-slate-400 text-sm font-semibold">준비 중</span>
        </div>
      </div>

      <button
        onClick={onStart}
        className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition"
      >
        점검 시작
      </button>
      <button
        onClick={onBack}
        className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700 text-xl font-bold py-4 hover:bg-slate-50 transition"
      >
        이전으로
      </button>
    </div>
  )
}

interface ChatScreenProps {
  step: (typeof SAFETY_SCANNER_PROTOCOL)[number]
  stepIndex: number
  messages: ScanMessage[]
  multiSelected: string[]
  noteDraft: string
  onNoteDraftChange: (v: string) => void
  voice: ReturnType<typeof useVoiceInput>
  photoPreview: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onPickPhotoFile: (file: File) => void
  onSingleAnswer: (option: ProtocolOption) => void
  onToggleMulti: (option: ProtocolOption) => void
  onSubmitMulti: () => void
  onPhotoNext: () => void
  onPhotoSkip: () => void
  onPrevQuestion: () => void
  onAbortRequest: () => void
  transcriptEndRef: RefObject<HTMLDivElement | null>
}

function ChatScreen({
  step,
  stepIndex,
  messages,
  multiSelected,
  noteDraft,
  onNoteDraftChange,
  voice,
  photoPreview,
  fileInputRef,
  onPickPhotoFile,
  onSingleAnswer,
  onToggleMulti,
  onSubmitMulti,
  onPhotoNext,
  onPhotoSkip,
  onPrevQuestion,
  onAbortRequest,
  transcriptEndRef,
}: ChatScreenProps) {
  const percent = Math.min(
    100,
    Math.round((stepIndex / Math.max(1, SAFETY_SCANNER_PROTOCOL.length - 1)) * 100),
  )

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-full bg-teal-500 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="text-teal-600 font-semibold text-sm mt-2 text-center tracking-wide">
          현재 점검영역: {AREA_LABELS[step.area]}
        </p>
      </div>

      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'ai'
                ? 'self-start max-w-[85%] rounded-3xl rounded-tl-lg bg-white border border-slate-100 shadow-sm px-4 py-3 text-slate-900 text-base leading-relaxed'
                : 'self-end max-w-[85%] rounded-3xl rounded-tr-lg bg-teal-600 text-white px-4 py-3 text-base leading-relaxed'
            }
          >
            {m.text}
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      {step.kind === 'question' && (
        <>
          <div className="flex flex-col gap-3">
            {step.answerType === 'single' &&
              step.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => onSingleAnswer(option)}
                  className="w-full min-h-[52px] rounded-3xl border-2 border-slate-200 bg-white text-slate-900 text-lg font-bold py-3 px-4 hover:border-teal-500 hover:bg-teal-50 transition"
                >
                  {option.label}
                </button>
              ))}

            {step.answerType === 'multi' && (
              <>
                {step.options.map((option) => {
                  const selected = multiSelected.includes(option.id)
                  return (
                    <button
                      key={option.id}
                      onClick={() => onToggleMulti(option)}
                      aria-pressed={selected}
                      className={`flex items-center justify-between gap-2 w-full min-h-[52px] rounded-3xl border-2 text-lg font-bold py-3 px-4 transition ${
                        selected
                          ? 'bg-teal-600 border-teal-600 text-white'
                          : 'bg-white border-slate-200 text-slate-900 hover:border-teal-500 hover:bg-teal-50'
                      }`}
                    >
                      <span>{option.label}</span>
                      {selected && <CheckIcon className="w-5 h-5 shrink-0" />}
                    </button>
                  )
                })}
                <button
                  onClick={onSubmitMulti}
                  disabled={multiSelected.length === 0}
                  className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  다음
                </button>
              </>
            )}
          </div>

          <NoteInput noteDraft={noteDraft} onNoteDraftChange={onNoteDraftChange} voice={voice} />
        </>
      )}

      {step.kind === 'photo' && (
        <PhotoStepView
          prompt={step.prompt}
          photoPreview={photoPreview}
          fileInputRef={fileInputRef}
          onPickPhotoFile={onPickPhotoFile}
          onNext={onPhotoNext}
          onSkip={onPhotoSkip}
        />
      )}

      <div className="flex justify-between items-center mt-2">
        <button
          onClick={onPrevQuestion}
          className="text-slate-400 text-base hover:text-slate-600 transition"
        >
          이전 질문
        </button>
        <button
          onClick={onAbortRequest}
          className="text-red-400 text-base hover:text-red-600 transition"
        >
          점검 중단
        </button>
      </div>
    </div>
  )
}

function NoteInput({
  noteDraft,
  onNoteDraftChange,
  voice,
}: {
  noteDraft: string
  onNoteDraftChange: (v: string) => void
  voice: ReturnType<typeof useVoiceInput>
}) {
  const isListening = voice.voiceState === 'listening'

  useEffect(() => {
    if (voice.interimText) onNoteDraftChange(voice.interimText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.interimText])

  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-2">
      <p className="text-slate-400 text-sm font-semibold">관찰 메모 (선택)</p>
      <div className="flex items-center gap-2">
        <textarea
          value={noteDraft}
          onChange={(e) => onNoteDraftChange(e.target.value)}
          placeholder="어르신이 하신 말씀이나 관찰한 내용을 적어주세요."
          rows={2}
          className="flex-1 text-base text-slate-900 leading-relaxed focus:outline-none resize-none placeholder:text-slate-400"
        />
        <button
          onClick={() => voice.startListening((text) => onNoteDraftChange(text))}
          aria-label="음성으로 메모 입력"
          className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition ${
            isListening
              ? 'bg-red-500 text-white animate-pulse'
              : 'bg-teal-100 text-teal-700 hover:bg-teal-200'
          }`}
        >
          <MicIcon className="w-5 h-5" />
        </button>
      </div>
      {voice.voiceState === 'unsupported' && (
        <p className="text-slate-400 text-xs">
          이 기기에서는 음성입력을 지원하지 않아요. 텍스트로 입력해 주세요.
        </p>
      )}
      {voice.voiceError && <p className="text-red-500 text-xs">{voice.voiceError}</p>}
    </div>
  )
}

function PhotoStepView({
  prompt,
  photoPreview,
  fileInputRef,
  onPickPhotoFile,
  onNext,
  onSkip,
}: {
  prompt: string
  photoPreview: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onPickPhotoFile: (file: File) => void
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-4">
      <p className="text-slate-700 text-base leading-relaxed">{prompt}</p>
      <p className="text-slate-400 text-xs leading-relaxed flex items-start gap-1.5">
        <ShieldIcon className="w-4 h-4 shrink-0 mt-0.5" />
        {PHOTO_PRIVACY_NOTICE}
      </p>

      {photoPreview ? (
        <div className="rounded-2xl overflow-hidden border border-slate-200">
          <img src={photoPreview} alt="촬영된 현장사진 미리보기" className="w-full max-h-56 object-cover" />
        </div>
      ) : (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPickPhotoFile(file)
          }}
        />
      )}

      <p className="text-slate-400 text-xs text-center">AI 사진분석 준비 중 · 이 세션에서만 미리보기됩니다</p>

      {!photoPreview && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full min-h-[52px] rounded-full border-2 border-teal-600 text-teal-700 bg-white text-lg font-bold py-3 flex items-center justify-center gap-2 hover:bg-teal-50 transition"
        >
          <CameraIcon className="w-5 h-5" />
          사진 촬영 / 첨부하기
        </button>
      )}

      <div className="flex flex-col gap-3">
        <button
          onClick={onNext}
          disabled={!photoPreview}
          className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          다음
        </button>
        <button
          onClick={onSkip}
          className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700 text-lg font-bold py-3 hover:bg-slate-50 transition"
        >
          촬영하지 않고 계속
        </button>
      </div>
    </div>
  )
}

function EmergencyScreen({ area, onProceed }: { area: SafetyArea; onProceed: () => void }) {
  const guidance = EMERGENCY_GUIDANCE[area]
  return (
    <div className="flex flex-col gap-4 pt-2">
      <a
        href="tel:119"
        className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-3xl text-xl font-bold py-4 bg-red-600 text-white shadow-lg hover:bg-red-700 transition"
      >
        지금 119에 전화하기
      </a>

      <div className="rounded-3xl bg-red-50 border border-red-200 p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <AlertIcon className="w-6 h-6 text-red-600 shrink-0" />
          <h2 className="text-xl font-bold text-red-700">긴급 안내 · 우선 확인 필요</h2>
        </div>
        <ul className="text-red-800 text-lg leading-relaxed space-y-2 list-disc list-inside">
          {guidance.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </div>

      <button
        onClick={onProceed}
        className="w-full min-h-[52px] rounded-full bg-slate-900 text-white text-xl font-bold py-4 hover:bg-slate-800 transition"
      >
        확인했어요, 현장조치 입력하기
      </button>
    </div>
  )
}

function ActionsScreen({
  assessment,
  selected,
  note,
  onToggle,
  onNoteChange,
  onFinish,
}: {
  assessment: RiskAssessment
  selected: string[]
  note: string
  onToggle: (opt: string) => void
  onNoteChange: (v: string) => void
  onFinish: () => void
}) {
  const meta = RISK_LEVEL_META[assessment.level]
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className={`rounded-3xl border px-5 py-4 text-lg font-bold ${meta.bubbleClass}`}>
        <span className={`inline-block w-3 h-3 rounded-full mr-2 align-middle ${meta.barClass}`} />
        {meta.shortLabel}
      </div>

      <h2 className="text-xl font-bold text-slate-900 text-center">
        현재까지 어떤 조치를 하셨나요?
      </h2>
      <p className="text-slate-500 text-base text-center leading-relaxed">
        실제로 수행한 조치만 선택해 주세요.
      </p>

      <div className="flex flex-col gap-3">
        {IMMEDIATE_ACTION_OPTIONS.map((opt) => {
          const isSelected = selected.includes(opt)
          return (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              aria-pressed={isSelected}
              className={`flex items-center justify-between gap-2 w-full min-h-[52px] rounded-3xl border-2 text-lg font-bold py-3 px-4 transition ${
                isSelected
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : 'bg-white border-slate-200 text-slate-900 hover:border-teal-500 hover:bg-teal-50'
              }`}
            >
              <span>{opt}</span>
              {isSelected && <CheckIcon className="w-5 h-5 shrink-0" />}
            </button>
          )
        })}
      </div>

      {selected.includes('기타') && (
        <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
          <label className="block font-bold text-slate-900 text-base mb-2">직접 입력</label>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={3}
            className="w-full text-base text-slate-900 leading-relaxed focus:outline-none resize-none"
          />
        </div>
      )}

      <button
        onClick={onFinish}
        className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition"
      >
        현장조치 입력 완료
      </button>
    </div>
  )
}

function ResultScreen({
  result,
  finalized,
  onFinalize,
  onEdit,
  onHome,
  onNewScan,
}: {
  result: ScanResult
  finalized: boolean
  onFinalize: () => void
  onEdit: () => void
  onHome: () => void
  onNewScan: () => void
}) {
  const meta = RISK_LEVEL_META[result.riskAssessment.level]
  return (
    <div className="flex flex-col gap-4 pt-2">
      <h2 className="text-xl font-bold text-slate-900 text-center">생활안전 사례카드</h2>

      <div className={`rounded-3xl border px-5 py-4 text-lg font-bold ${meta.bubbleClass}`}>
        <span className={`inline-block w-3 h-3 rounded-full mr-2 align-middle ${meta.barClass}`} />
        {meta.shortLabel}
      </div>

      <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-3 divide-y divide-slate-100">
        <ResultRow label="점검일시" value={result.performedAt} />
        <ResultRow label="점검유형" value={result.scanType} />
        <ResultRow label="데모 대상자" value={result.demoSubjectName} />
        <ResultRow
          label="점검한 영역"
          value={result.areasChecked.map((a) => AREA_LABELS[a]).join(', ') || '없음'}
        />
        <ResultRow
          label="생활지원사 주요 관찰"
          value={result.observationSummary.join('\n') || '관찰 내용 없음'}
        />
        <ResultRow
          label="어르신이 말한 내용"
          value={result.subjectQuotes.join(' / ') || '기록된 발언 없음'}
        />
        <ResultRow
          label="발견된 위험요소"
          value={
            result.riskAssessment.signals.length
              ? result.riskAssessment.signals.map((s) => s.label).join(', ')
              : '현재 확인된 주요 위험신호 없음'
          }
        />
        <ResultRow
          label="첨부사진"
          value={
            result.evidencePhotos.length
              ? `현장사진 첨부됨 (촬영영역: ${result.evidencePhotos.map((p) => p.areaLabel).join(', ')})`
              : '첨부된 사진 없음'
          }
        />
        <ResultRow
          label="현장조치"
          value={
            [...result.immediateAction.selected, result.immediateAction.customText]
              .filter(Boolean)
              .join(', ') || '기록된 조치 없음'
          }
        />
        <ResultRow
          label="기관 확인 필요사항"
          value={result.institutionCheckNotes.join(' / ') || '해당 없음'}
        />
        <ResultRow
          label="추천 후속조치"
          value={result.followUpActions.map((f) => f.label).join(' / ')}
        />
        <ResultRow label="다음 방문 재점검 항목" value={result.nextVisitChecks.join(', ')} />
        <ResultRow label="처리상태" value={result.status} />
      </div>

      {result.evidencePhotos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {result.evidencePhotos.map((p) => (
            <img
              key={p.id}
              src={p.previewUrl}
              alt={`${p.areaLabel} 현장사진`}
              className="w-24 h-24 object-cover rounded-2xl border border-slate-200 shrink-0"
            />
          ))}
        </div>
      )}

      <p className="text-slate-400 text-xs text-center leading-relaxed">
        추천 후속조치는 확정적인 지원 판정이 아니라 검토가 필요한 항목입니다.
      </p>

      {finalized && (
        <p className="text-teal-700 bg-teal-50 border border-teal-100 rounded-2xl p-4 text-center text-base">
          기록이 완료되었습니다.
        </p>
      )}

      <div className="flex flex-col gap-3 mt-2">
        <button
          onClick={onFinalize}
          disabled={finalized}
          className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition disabled:bg-slate-300"
        >
          점검 기록 완료
        </button>
        <button
          onClick={onEdit}
          className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700 text-lg font-bold py-3 hover:bg-slate-50 transition"
        >
          내용 수정
        </button>
        <button
          onClick={onHome}
          className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700 text-lg font-bold py-3 hover:bg-slate-50 transition"
        >
          처음으로
        </button>
        <button
          onClick={onNewScan}
          className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700 text-lg font-bold py-3 hover:bg-slate-50 transition"
        >
          새로운 점검 시작
        </button>
      </div>
    </div>
  )
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="pt-3 first:pt-0">
      <p className="font-bold text-slate-900 text-sm mb-1">{label}</p>
      <p className="text-slate-700 text-base leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}

export default SafetyScannerApp
