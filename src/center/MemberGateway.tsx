import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { isDemoMode } from '../pilot/shared/demoMode'
import './center.css'
import './member.css'

export default function MemberGateway() {
  const demo = isDemoMode()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetch('/api/center/session').then(r => r.ok ? r.json() : null).then(d => { if (active && d?.authenticated) window.location.assign(d.redirect === '/care' ? '/care' : '/center') }).catch(() => undefined)
    return () => { active = false }
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form))
    if (mode === 'signup' && data.password !== data.passwordConfirm) { setError('비밀번호가 일치하지 않습니다.'); setBusy(false); return }
    try {
      const response = await fetch(`/api/center/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const body = await response.json().catch(() => ({ error: '회원 서버에 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.' }))
      if (!response.ok || !body.ok) throw new Error(body.error || '요청을 처리하지 못했습니다.')
      if (mode === 'signup') { form.reset(); setMode('login'); setMessage(body.message || '가입 신청이 접수되었습니다. 이메일 인증 후 기관 승인을 기다려 주세요.') }
      else window.location.assign(body.redirect === '/care' ? '/care' : '/center')
    } catch (e) { setError(e instanceof Error ? e.message : '연결을 확인해 주세요.') } finally { setBusy(false) }
  }
  return <div className="cd-root cd-entry"><header className="cd-entry-header"><a className="cd-brand" href="/">AI <b>365</b><span>CARE DREAM</span></a><span>기관과 현장을 잇는 돌봄 업무공간</span></header><main className="cd-entry-grid"><section className="cd-entry-intro"><span className="cd-eyebrow">ONE CENTER · CONNECTED CARE</span><h1>돌봄의 기록부터<br />센터의 하루까지.</h1><p>기관의 업무를 한 곳에서 관리하고,<br />현장의 돌봄보고를 사례관리로 연결합니다.</p><div className="cd-entry-flow"><div><b>01</b><strong>회원가입</strong><span>소속 기관과 기본정보 입력</span></div><div><b>02</b><strong>기관 승인</strong><span>마스터 관리자가 소속과 역할 확인</span></div><div><b>03</b><strong>업무 시작</strong><span>관리자 업무공간 · 요양보호사 돌봄보고</span></div></div><small>AI 365 CARE DREAM · 센터 운영과 현장 돌봄을 연결합니다.</small></section><section className="cd-login-card cd-entry-card"><span className="cd-eyebrow">MEMBER ACCESS</span><h2>{mode === 'login' ? '로그인' : '회원가입'}</h2><p>{mode === 'login' ? '승인된 계정으로 업무를 시작하세요.' : '가입 신청 후 마스터 관리자의 승인을 받으세요.'}</p><div className="cd-entry-tabs" role="tablist" aria-label="회원 메뉴"><button role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(''); setMessage('') }}>로그인</button><button role="tab" aria-selected={mode === 'signup'} onClick={() => { setMode('signup'); setError(''); setMessage('') }}>회원가입</button></div><form key={mode} onSubmit={submit}>{mode === 'signup' && <><label>이름<input name="name" autoComplete="name" maxLength={60} required /></label><label>소속 기관코드<input name="organizationCode" placeholder="기관에서 안내받은 코드" maxLength={40} required /></label><label>신청 역할<select name="requestedRole"><option value="caregiver">요양보호사</option><option value="admin">기관 관리자</option></select></label></>}<label>{mode === 'login' ? '아이디 또는 이메일' : '이메일'}<input name="email" type={mode === 'login' ? 'text' : 'email'} autoComplete="username" required maxLength={254} placeholder={mode === 'login' ? '아이디 또는 이메일 주소' : '이메일 주소'} /></label><label>비밀번호<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 12 : undefined} maxLength={128} placeholder={mode === 'signup' ? '12자 이상 입력' : '비밀번호 입력'} /></label>{mode === 'signup' && <label>비밀번호 확인<input name="passwordConfirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>}<button className="cd-primary" disabled={busy}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입 신청'}</button></form>{message && <p className="cd-notice" role="status">{message}</p>}{error && <p className="cd-entry-error" role="alert">{error}</p>}<small>소속 기관과 승인된 역할에 맞는 화면으로 연결됩니다.</small><a className="cd-entry-legacy" href={demo ? "/care?demo=1" : "/care"}>기존 참여자코드·PIN으로 돌봄보고 로그인 →</a>{import.meta.env.DEV && <a className="cd-entry-legacy" href="/center">센터 업무화면 로컬 검토 →</a>}</section></main></div>
}
