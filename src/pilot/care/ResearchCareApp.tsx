/**
 * 논문 연구용 요양보호사 화면(/care).
 * 흐름: 로그인 → AI 아바타 대화 → 어르신 선택 → 오늘 돌봄 말하기(음성/문자)
 *      → AI 되묻기 1~2개(하루 AI 1회) → 답하기(AI 호출 없음) → 원자료 전사본 즉시 저장(관리자 바로 열람)
 *      → 주 1회 "이번 주 정리하기"(AI 1회) → 초안 확인·수정 → 관리자에게 보내기.
 * 기존 60초 돌봄보고 화면(CareApp)은 /care/classic, 표준상황 연습은 /care/scenario에 그대로 둔다.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ApiClientError } from '../shared/api'
import { useContinuousVoice } from './useContinuousVoice'
import { CompanionHeader, type AvatarState } from './AiAvatar'
import './careConversation.css'
import { ConversationLog, type ConversationTurn } from './ConversationLog'
import { speakKorean, cancelSpeech, isSpeechSynthesisSupported, subscribeSpeech, getSpeechSnapshot } from './speechOutput'
import type { CareReportListItem, FollowupItem } from '../shared/types'
import { realCareRepo, type CareRepo } from '../shared/careRepo'
import { realResearchRepo, type ResearchRepo, type WeeklyDraft } from '../shared/researchRepo'
import { isDemoMode } from '../shared/demoMode'
import { demoCareRepo } from '../demo/demoCareRepo'
import { demoResearchRepo } from '../demo/demoResearchRepo'
import { resetDemoData } from '../demo/demoStore'
import { LoginScreen, PrimaryButton, SecondaryButton, Shell } from './CareApp'
import { addDays, dailySummaryLine, isNoChangeDay, weekStartOf } from '../../../shared/researchCare'

type Stage = 'first' | 'asking' | 'answering' | 'saving' | 'saved' | 'done_today'
type View = 'talk' | 'weekly'

function errorText(e: unknown, what: string): string {
  const status = e instanceof ApiClientError ? e.status : 0
  if (status === 401) return '로그인 시간이 만료됐어요. 다시 로그인해 주세요. 입력한 내용은 화면에 남아 있습니다.'
  if (status === 403) return '이 어르신의 기록 권한을 확인해 주세요.'
  const msg = e instanceof Error && e.message ? e.message : ''
  return `${what}하지 못했어요${msg ? ` (${msg})` : ''}. 입력한 내용은 화면에 남아 있습니다. 다시 시도해 주세요.`
}

function submittedToday(list: CareReportListItem[], recipient: string, today: string): boolean {
  return list.some((r) => r.recipient_code === recipient && r.report_date === today && r.report_type === 'daily'
    && (r.report_source ?? 'live') === 'live' && r.status === 'submitted')
}

export default function ResearchCareApp() {
  const demo = isDemoMode()
  const care: CareRepo = demo ? demoCareRepo : realCareRepo
  const research: ResearchRepo = demo ? demoResearchRepo : realResearchRepo

  const [phase, setPhase] = useState<'loading' | 'login' | 'app'>('loading')
  const [today, setToday] = useState('')
  const [recipients, setRecipients] = useState<Array<{ code: string; displayName: string | null }>>([])
  const [recipient, setRecipient] = useState('')
  const [reports, setReports] = useState<CareReportListItem[]>([])
  const [view, setView] = useState<View>('talk')

  const [stage, setStage] = useState<Stage>('first')
  const [reportId, setReportId] = useState<string | null>(null)
  const [rawInput, setRawInput] = useState('')
  const [inputMethod, setInputMethod] = useState<'voice' | 'text'>('text')
  const [questions, setQuestions] = useState<string[]>([])
  const [questionsSource, setQuestionsSource] = useState<'ai' | 'rule'>('rule')
  const [answers, setAnswers] = useState<string[]>([])
  const [draftText, setDraftText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  const voice = useContinuousVoice()
  const [audioEnabled, setAudioEnabled] = useState(() => isSpeechSynthesisSupported())
  const speaking = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot, () => false)

  // ── 로그인·세션 ─────────────────────────────────────────────
  async function loadSession() {
    const s = await care.getSession()
    if (!s.authenticated) { setPhase('login'); return }
    const list = s.recipients ?? s.recipientCodes.map((code) => ({ code, displayName: null }))
    setRecipients(list)
    setToday(s.today)
    setReports(await care.listReports().catch(() => []))
    setRecipient((cur) => (cur && list.some((r) => r.code === cur) ? cur : list[0]?.code ?? ''))
    setPhase('app')
  }
  useEffect(() => {
    loadSession().catch(() => setPhase('login'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 어르신을 바꾸거나 처음 들어오면 오늘 기록 여부에 맞춰 대화를 새로 시작한다.
  useEffect(() => {
    if (!recipient || !today) return
    resetTalk(submittedToday(reports, recipient, today) ? 'done_today' : 'first')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient, today])

  function resetTalk(next: Stage = 'first') {
    voice.cancel(); cancelSpeech()
    setStage(next); setReportId(null); setRawInput(''); setQuestions([]); setAnswers([]); setDraftText(''); setError(null)
  }

  async function logout() {
    voice.cancel(); cancelSpeech()
    await care.logout()
    setPhase('login'); setRecipient(''); setReports([])
  }

  const label = (code: string) => {
    const name = recipients.find((r) => r.code === code)?.displayName
    return name ? `${code} · ${name}` : code
  }

  // ── 하루 기록 ───────────────────────────────────────────────
  /** 처음 말하기를 시작할 때 기록을 연다(작성 시간 측정 시작점). */
  async function ensureReport(): Promise<string> {
    if (reportId) return reportId
    const { report } = await care.createReport({ recipientCode: recipient, reportType: 'daily', inputMethod })
    setReportId(report.id)
    return report.id
  }

  function say(text: string) {
    if (audioEnabled) speakKorean(text)
  }

  async function sendFirst(text: string, method: 'voice' | 'text') {
    const value = text.trim()
    if (!value || busy.current) return
    busy.current = true
    setError(null); setRawInput(value); setInputMethod(method); setDraftText(''); setStage('asking')
    try {
      const id = await ensureReport()
      // 원문은 AI를 부르기 전에 먼저 저장한다(AI가 실패해도 원자료는 남는다).
      await care.patchReport({ id, rawInput: value, inputMethod: method })
      const res = await research.ask(recipient, value)
      setQuestions(res.questions); setQuestionsSource(res.source); setAnswers([])
      setStage('answering')
      say(res.questions[0])
    } catch (e) {
      setError(errorText(e, '내용을 확인'))
      setStage('first'); setDraftText(value)
    } finally {
      busy.current = false
    }
  }

  async function answer(text: string) {
    const next = [...answers, text.trim()]
    setAnswers(next); setDraftText('')
    if (next.length < questions.length) { say(questions[next.length]); return }
    await save(next)
  }

  async function save(finalAnswers: string[]) {
    if (!reportId || busy.current) return
    busy.current = true
    setStage('saving'); setError(null)
    const turns: FollowupItem[] = questions.map((q, i) => ({ question: q, missingField: 'research_daily', answer: finalAnswers[i] ?? '' }))
    try {
      await care.patchReport({ id: reportId, rawInput, inputMethod, followupQuestions: turns, followupAnswers: turns, transcriptOnly: true, questionsSource, submit: true })
      setReports(await care.listReports().catch(() => reports))
      setStage('saved')
      say('기록을 남겼어요. 관리자에게 바로 전달됐습니다.')
    } catch (e) {
      setError(errorText(e, '저장'))
      setStage('answering')
    } finally {
      busy.current = false
    }
  }

  // 음성: 말하기 시작 → 말하기 완료로 확정 → 그대로 보낸다.
  function startVoice() {
    setError(null); cancelSpeech()
    if (stage === 'first') ensureReport().catch((e) => setError(errorText(e, '기록을 시작')))
    voice.start()
  }
  function finishVoice() {
    voice.finish((text) => {
      if (!text.trim()) return
      if (stage === 'first') void sendFirst(text, 'voice')
      else if (stage === 'answering') void answer(text)
    })
  }
  function submitText() {
    if (stage === 'first') void sendFirst(draftText, 'text')
    else if (stage === 'answering' && draftText.trim()) void answer(draftText)
  }

  const conversation: ConversationTurn[] = useMemo(() => {
    const t: ConversationTurn[] = []
    if (rawInput) t.push({ role: 'user', text: rawInput })
    questions.forEach((q, i) => {
      if (i <= answers.length && (stage === 'answering' || stage === 'saving' || stage === 'saved')) {
        t.push({ role: 'ai', text: q })
        if (i < answers.length) t.push({ role: 'user', text: answers[i] || '(넘어감)' })
      }
    })
    return t
  }, [rawInput, questions, answers, stage])

  const noChangeLine = stage === 'saved' && isNoChangeDay(rawInput)
    ? dailySummaryLine({ date: today, rawInput, turns: questions.map((q, i) => ({ question: q, answer: answers[i] ?? '' })), noChange: true }, [])
    : ''

  const avatarState: AvatarState =
    voice.state !== 'idle' ? 'listening'
      : stage === 'asking' ? 'processing'
        : stage === 'saving' ? 'sending'
          : speaking ? 'speaking'
            : stage === 'answering' ? 'question'
              : stage === 'saved' || stage === 'done_today' ? 'done'
                : error ? 'error' : 'idle'

  // ── 화면 ────────────────────────────────────────────────────
  if (phase === 'loading') {
    return <Shell demo={demo} onResetDemo={() => undefined}><p className="text-center text-slate-500 py-16">불러오는 중…</p></Shell>
  }
  if (phase === 'login') {
    return <LoginScreen demo={demo} title="요양보호사 로그인" subtitle="담당 어르신의 오늘 돌봄을 말로 남깁니다." onLogin={async (code, pin) => { await care.login(code, pin); await loadSession() }} />
  }

  const resetDemo = () => { resetDemoData(); window.location.reload() }
  const audioControl = isSpeechSynthesisSupported() ? (
    <button className="text-xs font-bold text-slate-500 underline" onClick={() => { cancelSpeech(); setAudioEnabled((v) => !v) }}>
      {audioEnabled ? '소리 끄기' : '소리 켜기'}
    </button>
  ) : null

  return (
    <Shell demo={demo} onResetDemo={resetDemo}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex gap-2" role="tablist">
          <button role="tab" aria-selected={view === 'talk'} onClick={() => setView('talk')}
            className={`rounded-full px-4 py-2 text-sm font-bold ${view === 'talk' ? 'bg-brand text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>오늘 기록</button>
          <button role="tab" aria-selected={view === 'weekly'} onClick={() => { voice.cancel(); setView('weekly') }}
            className={`rounded-full px-4 py-2 text-sm font-bold ${view === 'weekly' ? 'bg-brand text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>주간 정리</button>
        </div>
        <button onClick={logout} className="text-xs font-bold text-slate-500 underline shrink-0">로그아웃</button>
      </div>

      {recipients.length === 0 ? (
        <div className="rounded-3xl bg-amber-50 border border-amber-200 p-5 text-center mt-4">
          <p className="font-bold text-amber-800">배정된 어르신이 없습니다.</p>
          <p className="text-amber-700 text-sm mt-1">센터 관리자에게 배정을 요청해 주세요.</p>
        </div>
      ) : (
        <>
          <label className="block mb-3">
            <span className="block text-xs font-bold text-slate-500 mb-1">담당 어르신</span>
            <select value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={stage === 'asking' || stage === 'saving'}
              className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-lg font-bold">
              {recipients.map((r) => <option key={r.code} value={r.code}>{label(r.code)} 어르신</option>)}
            </select>
          </label>

          {view === 'talk' ? (
            <>
              <CompanionHeader expanded={stage === 'first' && !rawInput} state={avatarState} recipientCode={recipient}
                completed={stage === 'saved' || stage === 'done_today'} audioControl={audioControl} />
              <ConversationLog turns={conversation} />

              {stage === 'answering' && questionsSource === 'rule' && (
                <p className="text-xs text-slate-500 mt-2">{demo ? '시연 모드: AI 대신 규칙으로 만든 질문입니다.' : 'AI 연결이 안 되어 규칙으로 만든 질문입니다.'}</p>
              )}
              {error && <p role="alert" className="care-error mt-3">{error}</p>}

              {(stage === 'first' || stage === 'answering') && (
                <div className="mt-4 flex flex-col gap-3">
                  {voice.isSupported && (
                    voice.state === 'idle' ? (
                      <PrimaryButton onClick={startVoice}>{stage === 'first' ? '말로 이야기하기' : '말로 답하기'}</PrimaryButton>
                    ) : (
                      <div className="rounded-2xl bg-white border border-[#c9d4e8] p-3">
                        <p className="text-sm text-slate-700 min-h-[2.5rem]">{voice.text || '듣고 있어요…'}</p>
                        <PrimaryButton className="mt-2" onClick={finishVoice}>말하기 완료</PrimaryButton>
                      </div>
                    )
                  )}
                  {voice.error && <p className="text-sm text-amber-700">{voice.error}</p>}
                  <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3}
                    onFocus={() => { if (stage === 'first') ensureReport().catch((e) => setError(errorText(e, '기록을 시작'))) }}
                    placeholder={stage === 'first' ? '글로 적어도 됩니다. 특이사항이 없으면 "평소와 같았어요"라고 해 주세요.' : '답을 적어 주세요.'}
                    className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-base" />
                  <div className="flex gap-2">
                    <SecondaryButton onClick={submitText} disabled={!draftText.trim()}>{stage === 'first' ? '글로 보내기' : '답 보내기'}</SecondaryButton>
                    {stage === 'answering' && <SecondaryButton onClick={() => void answer('')}>넘어가기</SecondaryButton>}
                  </div>
                </div>
              )}

              {stage === 'asking' && <p className="text-center text-slate-500 mt-4">말씀하신 내용을 확인하고 있어요…</p>}
              {stage === 'saving' && <p className="text-center text-slate-500 mt-4">저장하고 있어요…</p>}

              {stage === 'saved' && (
                <div className="mt-4 rounded-3xl bg-brand-tint border border-[#c9d4e8] p-5">
                  <p className="font-bold text-brand">오늘 기록을 남겼어요.</p>
                  <p className="text-sm text-brand mt-1">관리자 화면에서 바로 볼 수 있어요.</p>
                  {noChangeLine && <p className="text-sm text-slate-700 mt-2">{noChangeLine}</p>}
                  <div className="mt-4 flex flex-col gap-2">
                    <PrimaryButton onClick={() => setView('weekly')}>이번 주 정리 보기</PrimaryButton>
                    {recipients.length > 1 && <SecondaryButton onClick={() => {
                      const next = recipients.find((r) => !submittedToday(reports, r.code, today))
                      if (next) setRecipient(next.code)
                    }}>다른 어르신 기록하기</SecondaryButton>}
                  </div>
                </div>
              )}
              {stage === 'done_today' && (
                <div className="mt-4 rounded-3xl bg-slate-50 border border-slate-200 p-5 text-center">
                  <p className="font-bold text-slate-800">오늘 {recipient} 어르신 기록은 이미 남겼어요.</p>
                  <SecondaryButton className="mt-3" onClick={() => setView('weekly')}>이번 주 정리 보기</SecondaryButton>
                </div>
              )}
            </>
          ) : (
            <WeeklyPanel key={recipient} research={research} recipient={recipient} today={today} demo={demo} />
          )}
        </>
      )}
    </Shell>
  )
}

function WeeklyPanel({ research, recipient, today, demo }: { research: ResearchRepo; recipient: string; today: string; demo: boolean }) {
  const thisWeek = weekStartOf(today)
  const [week, setWeek] = useState(thisWeek)
  const [weekly, setWeekly] = useState<WeeklyDraft | null>(null)
  const [dayCount, setDayCount] = useState(0)
  const [text, setText] = useState('')
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null)
  const loading = loadedWeek !== week
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openedAt = useRef<number>(0)

  useEffect(() => {
    let active = true
    research.getWeekly(recipient, week)
      .then((r) => {
        if (!active) return
        setError(null); setWeekly(r.weekly); setDayCount(r.dayCount)
        setText(r.weekly?.caregiver_text ?? r.weekly?.ai_draft ?? '')
        openedAt.current = Date.now()
      })
      .catch((e) => { if (active) { setWeekly(null); setError(errorText(e, '주간 기록을 불러오')) } })
      .finally(() => { if (active) setLoadedWeek(week) })
    return () => { active = false }
  }, [research, recipient, week])

  async function prepare() {
    setBusy(true); setError(null)
    try {
      const r = await research.prepareWeekly(recipient, week)
      setWeekly(r.weekly); setText(r.weekly.ai_draft ?? ''); openedAt.current = Date.now()
    } catch (e) { setError(errorText(e, '주간 초안을 만들')) } finally { setBusy(false) }
  }

  async function send() {
    if (!weekly) return
    setBusy(true); setError(null)
    try {
      const r = await research.sendWeekly(weekly.id, text.trim(), (Date.now() - openedAt.current) / 1000)
      setWeekly(r.weekly)
    } catch (e) { setError(errorText(e, '보내')) } finally { setBusy(false) }
  }

  const weekLabel = `${week.slice(5).replace('-', '/')} ~ ${addDays(week, 6).slice(5).replace('-', '/')}`
  return (
    <section className="mt-2 flex flex-col gap-3">
      <div className="flex gap-2">
        <button onClick={() => setWeek(addDays(thisWeek, -7))} className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-bold ${week !== thisWeek ? 'bg-brand text-white' : 'bg-white text-slate-600'}`}>지난주</button>
        <button onClick={() => setWeek(thisWeek)} className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-bold ${week === thisWeek ? 'bg-brand text-white' : 'bg-white text-slate-600'}`}>이번 주</button>
      </div>
      <p className="text-sm text-slate-600">{weekLabel} · 저장된 하루 기록 {dayCount}일</p>
      {loading && <p className="text-slate-500">불러오는 중…</p>}
      {error && <p role="alert" className="care-error">{error}</p>}

      {!loading && !weekly && (
        <div className="rounded-3xl bg-white border border-slate-200 p-5">
          <p className="text-slate-700">이번 주 하루 기록을 묶어 주간 상태변화기록 초안을 만듭니다.</p>
          <p className="text-xs text-slate-500 mt-1">한 주에 한 번만 만들어집니다.</p>
          <PrimaryButton className="mt-4" onClick={prepare} disabled={busy || dayCount === 0}>{busy ? '정리하는 중…' : '이번 주 정리하기'}</PrimaryButton>
        </div>
      )}

      {!loading && weekly && weekly.status === 'draft' && (
        <div className="rounded-3xl bg-white border border-[#c9d4e8] p-5">
          <p className="font-bold text-slate-900">이렇게 정리했는데 관리자에게 보낼까요?</p>
          <p className="text-xs text-slate-500 mt-1">
            {weekly.ai_model === 'rule' ? (demo ? '시연 모드: AI 없이 날짜별 기록을 모은 자동 정리입니다.' : 'AI 연결이 안 되어 날짜별 기록을 모은 자동 정리입니다.') : 'AI가 만든 초안입니다. 틀린 곳은 직접 고쳐 주세요.'}
          </p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12}
            className="mt-3 w-full rounded-2xl border border-slate-300 p-3 text-base leading-relaxed" />
          <PrimaryButton className="mt-3" onClick={send} disabled={busy || !text.trim()}>{busy ? '보내는 중…' : '관리자에게 보내기'}</PrimaryButton>
        </div>
      )}

      {!loading && weekly && weekly.status !== 'draft' && (
        <div className="rounded-3xl bg-brand-tint border border-[#c9d4e8] p-5">
          <p className="font-bold text-brand">관리자에게 보냈어요{weekly.sent_at ? ` (${new Date(weekly.sent_at).toLocaleString('ko-KR')})` : ''}.</p>
          {weekly.status === 'confirmed' && <p className="text-sm text-brand mt-1">관리자가 확인을 마쳤습니다.</p>}
          <p className="mt-3 whitespace-pre-wrap text-slate-800 text-base">{weekly.caregiver_text}</p>
        </div>
      )}
    </section>
  )
}
