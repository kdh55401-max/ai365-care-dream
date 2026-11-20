import { isDemoMode } from '../pilot/shared/demoMode'
import { AvatarVideo } from '../pilot/care/AvatarVideo'
import '../pilot/care/careConversation.css'
import { CENTER_MOBILE, CENTER_PHONE, telHref } from '../pilot/shared/centerContact'

/**
 * 첫 화면. 글자 로고(AI365 CARE DREAM, B안 블루) + 아바타 + 로그인 입구 3개만 둔다.
 * 기능은 보이지 않고, 각 입구(/care, /admin, /office)는 로그인 전에는 로그인 화면만 보여 준다.
 * 색은 흰 바탕·검정 글씨에 블루 한 가지를 "요양보호사" 입구에만 쓴다.
 * 센터 전화·휴대폰은 사용자 확인(2026-11-20) 값. 센터 소개·주소·사진은 아직 비워 둔다.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`font-brand font-semibold tracking-[0.3em] text-brand whitespace-nowrap ${className}`}>AI365 CARE DREAM</span>
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export default function Landing() {
  const suffix = isDemoMode() ? '?demo=1' : ''
  return (
    <div className="min-h-dvh bg-white text-[#111827] flex flex-col">
      <header className="w-full border-b border-[#e5e7eb]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8 h-16 flex items-center justify-center lg:justify-between">
          <a href={'/' + suffix} aria-label="AI365 CARE DREAM 첫 화면"><Wordmark className="text-[15px] sm:text-lg" /></a>
          <span className="hidden lg:block text-sm font-medium text-[#374151]">가드림365재가복지센터</span>
        </div>
      </header>

      <main className="flex-1 w-full mx-auto max-w-6xl px-4 sm:px-8 py-6 lg:py-16 grid gap-6 lg:gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <section className="text-center lg:text-left">
          <p className="lg:hidden text-sm font-medium tracking-wide text-[#374151]">가드림365재가복지센터</p>
          <h1 className="mt-4 lg:mt-0 text-[30px] sm:text-4xl lg:text-5xl font-extrabold leading-[1.25] tracking-[-0.02em]">
            돌봄의 기록부터<br />센터의 하루까지
          </h1>
          <p className="mt-4 text-[15px] sm:text-base font-medium text-[#374151]">말하기 · AI 확인 · 관리자 검토</p>
        </section>

        <section className="w-full max-w-md mx-auto lg:mx-0 lg:justify-self-end">
          <div className="mx-auto w-36 h-36 sm:w-56 sm:h-56 overflow-hidden"><AvatarVideo home /></div>
          <p className="mt-2 text-center text-[15px] font-medium text-[#374151]">오늘도 수고 많으셨어요</p>

          <p className="mt-5 pt-5 border-t border-[#e5e7eb] text-[15px] font-bold">로그인할 업무를 선택하세요</p>
          <nav className="mt-3 flex flex-col gap-3" aria-label="로그인 입구">
            <a href={'/care' + suffix}
              className="block bg-brand hover:bg-brand-hover text-white px-5 py-4 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#93b4f5]">
              <span className="block text-lg font-bold">요양보호사</span>
              <span className="block text-[15px] text-[#dbe5f6]">말로 기록하기</span>
            </a>
            <a href={'/admin' + suffix}
              className="block border border-[#111827] hover:bg-[#f7f8fa] px-5 py-4 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#93b4f5]">
              <span className="block text-lg font-bold">관리자·사회복지사</span>
              <span className="block text-[15px] text-[#374151]">기록 확인·검토</span>
            </a>
            <a href={'/office' + suffix}
              className="flex items-center justify-center gap-2 py-3 text-sm text-[#374151] underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-[#93b4f5]">
              <LockIcon /> 센터 업무 지원 (대표 전용)
            </a>
            <a href="/demo"
              className="flex items-center justify-center gap-2 py-3 text-sm text-[#374151] border-t border-[#e5e7eb] underline-offset-4 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-[#93b4f5]">
              <LockIcon /> 앱 소개·체험 (시연용)
            </a>
          </nav>
          {suffix && <p className="mt-2 text-center text-xs font-semibold text-amber-700">시연용 화면입니다. 실제 기록은 저장되지 않습니다.</p>}
        </section>
      </main>

      <footer className="w-full border-t border-[#e5e7eb]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8 py-4 text-[13px] text-[#4b5563] text-center lg:text-left flex flex-col lg:flex-row gap-1 lg:gap-4">
          <span>AI365 CARE DREAM · 가드림365재가복지센터</span>
          <span>전화 <a className="font-semibold text-brand" href={telHref(CENTER_PHONE)}>{CENTER_PHONE}</a> · 휴대폰 <a className="font-semibold text-brand" href={telHref(CENTER_MOBILE)}>{CENTER_MOBILE}</a></span>
        </div>
      </footer>
    </div>
  )
}
