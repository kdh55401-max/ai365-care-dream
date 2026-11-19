import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { isDemoMode } from '../pilot/shared/demoMode'
import { DEMO_ALIAS_PASSWORD } from '../pilot/demo/demoStore'

/**
 * 센터 업무 지원 시스템(/office). 센터 대표(센터 회원의 master 권한)만 들어온다.
 * 이번 단계는 로그인과 빈 대시보드 틀까지만 둔다. 세부 기능은 다음 단계에서 정한다.
 * 기존 센터 ERP(/center)와는 별개 화면이며 그 데이터를 읽지 않는다.
 */
type Access = 'checking' | 'login' | 'ready'
const DEMO_KEY = 'ai365-office-demo'

const SECTIONS = [
  { title: '평가 준비', note: '평가 항목별 준비 현황을 한곳에서 확인합니다.' },
  { title: '문서 정리', note: '센터 문서와 서식을 모아 봅니다.' },
  { title: '엑셀 자료 관리', note: '엑셀로 관리하던 자료를 모아 봅니다.' },
]

function readDemo(): boolean {
  try { return sessionStorage.getItem(DEMO_KEY) === '1' } catch { return false }
}
function writeDemo(on: boolean) {
  try { if (on) sessionStorage.setItem(DEMO_KEY, '1'); else sessionStorage.removeItem(DEMO_KEY) } catch { /* 저장소 없음 */ }
}

export default function OfficeApp() {
  const demo = isDemoMode()
  const [access, setAccess] = useState<Access>(() => (demo ? (readDemo() ? 'ready' : 'login') : 'checking'))
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (demo) return
    let active = true
    fetch('/api/center/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return
        if (d?.authenticated && d.role === 'master') { setName(d.name || ''); setAccess('ready') }
        else setAccess('login')
      })
      .catch(() => { if (active) setAccess('login') })
    return () => { active = false }
  }, [demo])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    try {
      if (demo) {
        if (data.password !== DEMO_ALIAS_PASSWORD) throw new Error('시연용 비밀번호가 맞지 않습니다.')
        writeDemo(true); setName('시연용 대표'); setAccess('ready'); return
      }
      const res = await fetch('/api/center/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password }),
      })
      const body = await res.json().catch(() => ({ error: '서버에 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.' }))
      if (!res.ok || !body.ok) throw new Error(body.error || '로그인하지 못했습니다.')
      if (body.role !== 'master') {
        await fetch('/api/center/login', { method: 'DELETE' }).catch(() => undefined)
        throw new Error('센터 대표 계정만 이용할 수 있습니다.')
      }
      const s = await fetch('/api/center/session').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      setName(s?.name || ''); setAccess('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : '연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    if (demo) writeDemo(false)
    else await fetch('/api/center/login', { method: 'DELETE' }).catch(() => undefined)
    setName(''); setAccess('login')
  }

  const home = demo ? '/?demo=1' : '/'

  return (
    <div className="min-h-dvh bg-white text-[#111827]">
      <header className="px-4 py-4 flex items-center justify-between gap-3 max-w-3xl mx-auto">
        <a href={home} className="min-w-0">
          <span className="block font-brand text-sm font-semibold tracking-[0.3em] text-brand">AI365 CARE DREAM</span>
          <span className="block mt-1 text-base font-bold">센터 업무 지원 시스템</span>
        </a>
        {access === 'ready' && (
          <button onClick={logout} className="shrink-0 rounded-xl border border-[#d6dbe4] px-3 py-2 text-sm font-bold bg-white">로그아웃</button>
        )}
      </header>
      {demo && <p className="text-center text-xs font-bold text-amber-700 px-4">시연용 화면입니다.</p>}

      {access === 'checking' && <p className="text-center text-sm text-slate-500 py-16">로그인 상태를 확인하고 있습니다…</p>}

      {access === 'login' && (
        <main className="max-w-md mx-auto px-4 py-8">
          <h1 className="text-xl font-bold">대표 로그인</h1>
          <p className="mt-1 text-sm text-slate-600">센터 대표 계정으로만 들어올 수 있습니다.</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <label className="block">
              <span className="block font-bold text-base mb-1">이메일</span>
              <input name="email" type={demo ? 'text' : 'email'} autoComplete="username" required={!demo}
                placeholder={demo ? '시연용: 아무 값' : ''}
                className="w-full text-lg border border-slate-300 rounded-2xl p-4 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]" />
            </label>
            <label className="block">
              <span className="block font-bold text-base mb-1">비밀번호</span>
              <input name="password" type="password" autoComplete="current-password" required
                placeholder={demo ? `시연용: ${DEMO_ALIAS_PASSWORD}` : ''}
                className="w-full text-lg border border-slate-300 rounded-2xl p-4 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]" />
            </label>
            {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
            <button disabled={busy} className="rounded-2xl bg-brand hover:bg-brand-hover text-white text-lg font-bold py-4 disabled:opacity-60">
              {busy ? '확인 중…' : '로그인'}
            </button>
          </form>
        </main>
      )}

      {access === 'ready' && (
        <main className="max-w-3xl mx-auto px-4 py-6">
          <p className="text-sm text-slate-600">{name ? `${name}님, ` : ''}세부 기능은 다음 단계에서 정합니다.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {SECTIONS.map((s) => (
              <section key={s.title} className="rounded-3xl bg-white border border-[#e5e7eb] p-5">
                <h2 className="text-lg font-bold">{s.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{s.note}</p>
                <p className="mt-4 text-xs font-bold text-[#6b7280]">준비 중</p>
              </section>
            ))}
          </div>
        </main>
      )}
    </div>
  )
}
