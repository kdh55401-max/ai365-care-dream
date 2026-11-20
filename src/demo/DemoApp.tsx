import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Wordmark } from '../landing/Landing'
import { AiAvatar, type AvatarState } from '../pilot/care/AiAvatar'
import { useContinuousVoice } from '../pilot/care/useContinuousVoice'
import { cancelSpeech, getSpeechSnapshot, isSpeechSynthesisSupported, speakKorean, subscribeSpeech } from '../pilot/care/speechOutput'
import { GuidelineButton } from '../pilot/care/GuidelineBook'
import '../pilot/care/careConversation.css'

/**
 * /demo — 앱 소개·체험(시연용). 교수님 등 처음 보는 분이 "이런 앱이구나"를 이해하고,
 * 이어서 아바타와 실제 AI(센터 서버 계정)로 말을 주고받아 보게 한다.
 * 비밀번호는 서버가 확인한다. 대화는 저장하지 않는다.
 */
const PW_KEY = 'ai365-demo-pw'
type Turn = { role: 'user' | 'model'; text: string }

function readPw(): string {
  try { return sessionStorage.getItem(PW_KEY) ?? '' } catch { return '' }
}
function savePw(pw: string) {
  try { if (pw) sessionStorage.setItem(PW_KEY, pw); else sessionStorage.removeItem(PW_KEY) } catch { /* 저장 못 해도 화면은 계속 */ }
}

async function callDemo(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/care/ai-turn', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : '서버에 연결하지 못했어요.')
  return data
}

export default function DemoApp() {
  const [pw, setPw] = useState(readPw)
  const [step, setStep] = useState<'login' | 'intro' | 'chat'>(() => (readPw() ? 'intro' : 'login'))
  return (
    <div className="min-h-dvh bg-white text-[#111827] flex flex-col">
      <header className="w-full border-b border-[#e5e7eb]">
        <div className="mx-auto max-w-3xl px-4 h-16 flex items-center justify-between">
          <a href="/" aria-label="첫 화면으로"><Wordmark className="text-[15px]" /></a>
          {step !== 'login' && (
            <button type="button" className="text-sm text-[#374151] underline-offset-4 hover:underline"
              onClick={() => { cancelSpeech(); savePw(''); setPw(''); setStep('login') }}>나가기</button>
          )}
        </div>
      </header>
      {step === 'login' && <DemoLogin onOk={(p) => { savePw(p); setPw(p); setStep('intro') }} />}
      {step === 'intro' && <DemoIntro onStart={() => setStep('chat')} />}
      {step === 'chat' && <DemoChat pw={pw} onBack={() => { cancelSpeech(); setStep('intro') }} />}
    </div>
  )
}

function DemoLogin({ onOk }: { onOk: (pw: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await callDemo({ mode: 'demo-login', password: value }); onOk(value) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return (
    <main className="flex-1 w-full max-w-sm mx-auto px-4 py-16">
      <p className="text-sm font-medium text-[#374151]">가드림365재가복지센터</p>
      <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.02em]">앱 소개·체험</h1>
      <p className="mt-2 text-[15px] text-[#374151]">시연용 화면입니다. 안내받은 비밀번호를 입력해 주세요.</p>
      <form className="mt-8 flex flex-col gap-3" onSubmit={submit}>
        <label htmlFor="demo-pw" className="text-sm font-bold">시연 비밀번호</label>
        <input id="demo-pw" type="password" inputMode="numeric" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)}
          className="h-14 px-4 border border-[#d1d5db] text-lg focus:outline-none focus:border-brand focus:ring-2 focus:ring-[#93b4f5]" />
        {error && <p role="alert" className="text-sm font-semibold text-red-700">{error}</p>}
        <button type="submit" disabled={!value || busy}
          className="h-14 bg-brand hover:bg-brand-hover disabled:bg-[#9ca3af] text-white text-lg font-bold">{busy ? '확인 중…' : '들어가기'}</button>
      </form>
    </main>
  )
}

const STEPS = [
  { n: '01', who: '요양보호사', title: '말로 기록', body: '어르신 댁 방문을 마치고, 오늘 본 모습을 휴대폰에 대고 편하게 말합니다. 글을 쓰지 않아도 됩니다.' },
  { n: '02', who: 'AI 돌봄 동료', title: 'AI 확인', body: '들은 내용을 정리하고, 빠진 것이 있으면 한두 가지만 되묻습니다. 예: "식사는 평소보다 얼마나 드셨어요?"' },
  { n: '03', who: '관리자·사회복지사', title: '관리자 검토', body: '한 주 정리본을 보고 평소와 달라진 점을 확인해 확정합니다. 필요하면 보호자 연락·방문 조정으로 이어집니다.' },
]

function DemoIntro({ onStart }: { onStart: () => void }) {
  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 sm:py-12">
      <p className="text-sm font-bold text-brand">이런 앱입니다</p>
      <h1 className="mt-2 text-[26px] sm:text-4xl font-extrabold leading-[1.3] tracking-[-0.02em]">
        요양보호사가 <span className="text-brand">말로 남긴 돌봄 이야기</span>를<br className="hidden sm:block" /> AI가 확인하고, 센터가 함께 살핍니다
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-[#374151]">
        재가 돌봄은 요양보호사 한 분이 어르신 댁을 혼자 방문합니다. 식사량이 줄거나 걸음이 느려지는 작은 변화는
        바쁜 현장에서 글로 남기기 어려워 그냥 지나가기 쉽습니다. AI365 CARE DREAM은 이 변화를 <b>말 한마디로</b> 남기고,
        센터가 <b>놓치지 않고</b> 확인하게 돕는 기록 도구입니다.
      </p>

      <section className="mt-8 grid gap-3 sm:grid-cols-3" aria-label="쓰는 순서">
        {STEPS.map((s) => (
          <div key={s.n} className="border border-[#e5e7eb] p-5">
            <p className="font-brand text-sm font-semibold tracking-[0.2em] text-brand">{s.n}</p>
            <p className="mt-2 text-lg font-bold">{s.title}</p>
            <p className="text-sm font-semibold text-[#4b5563]">{s.who}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-[#374151]">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 bg-[#f7f8fa] p-5" aria-label="안전장치">
        <p className="text-base font-bold">이렇게 안전하게 씁니다</p>
        <ul className="mt-2 grid gap-1.5 text-[15px] text-[#374151] list-disc pl-5">
          <li>AI는 진단·처방을 하지 않습니다. 위급하면 119와 센터에 먼저 연락하도록 안내합니다.</li>
          <li>어르신 이름은 코드로 바꾸고 전화번호는 가린 뒤 AI에 보냅니다.</li>
          <li>AI는 개인 계정이 아니라 센터 계정 하나로만 씁니다.</li>
          <li>최종 판단과 확정은 언제나 관리자·사회복지사가 합니다.</li>
        </ul>
      </section>

      <section className="mt-8 border-t border-[#e5e7eb] pt-8 flex flex-col sm:flex-row items-center gap-6">
        <div className="w-36 h-36 shrink-0 overflow-hidden"><AiAvatar state="idle" size="sm" /></div>
        <div className="flex-1 text-center sm:text-left">
          <p className="text-lg font-bold">직접 대화해 보세요</p>
          <p className="mt-1 text-[15px] text-[#374151]">화면 속 AI 돌봄 동료와 실제 AI로 말을 주고받습니다. 앱이 궁금한 점을 묻거나, 요양보호사가 된 것처럼 오늘 돌봄 이야기를 해 보세요.</p>
          <button type="button" onClick={onStart}
            className="mt-4 w-full sm:w-auto px-8 h-14 bg-brand hover:bg-brand-hover text-white text-lg font-bold">아바타와 대화해 보기</button>
        </div>
      </section>
    </main>
  )
}

const SUGGESTIONS = ['이 앱은 어떤 앱인가요?', '요양보호사는 하루에 어떻게 쓰나요?', '오늘 어르신이 점심을 반만 드시고 많이 피곤해 보이셨어요.']

function DemoChat({ pw, onBack }: { pw: string; onBack: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([{ role: 'model', text: '안녕하세요, AI 돌봄 동료예요. 이 앱이 궁금한 점을 물어보시거나, 요양보호사가 되어 오늘 어르신 이야기를 들려주세요.' }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sound, setSound] = useState(isSpeechSynthesisSupported())
  const speaking = useSyncExternalStore(subscribeSpeech, getSpeechSnapshot, () => false)
  const voice = useContinuousVoice()
  const listRef = useRef<HTMLDivElement>(null)
  const listening = voice.state !== 'idle'

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [turns, busy])
  useEffect(() => () => cancelSpeech(), [])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    cancelSpeech()
    setError(null); setDraft(''); setBusy(true)
    const history = turns.slice(1)
    setTurns((t) => [...t, { role: 'user', text: message }])
    try {
      const data = await callDemo({ mode: 'demo-chat', password: pw, message, history })
      const reply = typeof data.reply === 'string' ? data.reply : null
      if (!reply) { setError(typeof data.error === 'string' ? data.error : 'AI 답을 받지 못했어요.'); return }
      setTurns((t) => [...t, { role: 'model', text: reply }])
      if (sound) speakKorean(reply)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const toggleMic = () => {
    if (listening) { voice.finish((t) => { if (t.trim()) void send(t) }); return }
    cancelSpeech(); setDraft(''); voice.start()
  }

  const state: AvatarState = busy ? 'processing' : listening ? 'listening' : speaking ? 'speaking' : 'idle'
  const stateLabel = { processing: '생각하고 있어요', listening: '듣고 있어요', speaking: '말씀드리고 있어요' } as Record<string, string>

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 overflow-hidden"><AiAvatar state={state} size="sm" /></div>
        <div className="flex-1">
          <p className="text-lg font-bold">AI 돌봄 동료</p>
          <p className="text-[15px] text-[#374151]" role="status" aria-live="polite">{stateLabel[state] ?? '편하게 말씀해 주세요'}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="text-[#374151] underline-offset-4 hover:underline" onClick={onBack}>← 앱 소개</button>
            {isSpeechSynthesisSupported() && (
              <button type="button" className="text-brand font-semibold underline-offset-4 hover:underline" aria-pressed={sound}
                onClick={() => { if (sound) cancelSpeech(); setSound(!sound) }}>{sound ? '소리 끄기' : '소리로 듣기'}</button>
            )}
            <GuidelineButton />
          </div>
        </div>
      </div>

      <div ref={listRef} className="flex-1 min-h-[40dvh] max-h-[55dvh] overflow-y-auto border border-[#e5e7eb] bg-[#f7f8fa] p-3 flex flex-col gap-2" aria-label="대화 내용">
        {turns.map((t, i) => (
          <p key={i} className={(t.role === 'user' ? 'self-end bg-brand text-white' : 'self-start bg-white border border-[#e5e7eb] text-[#111827]') + ' max-w-[85%] px-4 py-2.5 text-[16px] leading-relaxed whitespace-pre-wrap'}>{t.text}</p>
        ))}
        {busy && <p className="self-start bg-white border border-[#e5e7eb] px-4 py-2.5 text-[15px] text-[#4b5563]">생각하고 있어요…</p>}
      </div>

      {turns.length <= 1 && (
        <div className="flex flex-wrap gap-2" aria-label="이렇게 말해 보세요">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => void send(s)} disabled={busy}
              className="px-3 py-2 text-sm border border-brand text-brand hover:bg-brand-tint text-left">{s}</button>
          ))}
        </div>
      )}
      {(error || voice.error) && <p role="alert" className="text-sm font-semibold text-red-700">{error ?? voice.error}</p>}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        {voice.isSupported && (
          <button type="button" onClick={toggleMic} disabled={busy} aria-pressed={listening}
            className={(listening ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-hover') + ' shrink-0 px-4 h-14 text-white font-bold disabled:bg-[#9ca3af]'}>
            {listening ? '말 끝내기' : '말하기'}
          </button>
        )}
        <input value={listening ? voice.text : draft} readOnly={listening} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="여기에 써도 됩니다" aria-label="보낼 말"
          className="flex-1 min-w-0 h-14 px-3 border border-[#d1d5db] text-[16px] focus:outline-none focus:border-brand focus:ring-2 focus:ring-[#93b4f5]" />
        <button type="submit" disabled={!draft.trim() || busy || listening}
          className="shrink-0 px-4 h-14 border border-[#111827] font-bold disabled:text-[#9ca3af] disabled:border-[#d1d5db]">보내기</button>
      </form>
      <p className="text-xs text-[#4b5563]">시연용 화면입니다. 대화는 저장되지 않습니다. 실제 이름·주소·전화번호는 말하지 마세요.</p>
    </main>
  )
}
