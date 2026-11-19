import { isDemoMode } from '../pilot/shared/demoMode'

/**
 * 첫 화면. 기능은 하나도 보이지 않고, 세 가지 로그인 입구만 둔다.
 * 각 입구(/care, /admin, /office)는 로그인 전에는 로그인 화면만 보여 준다.
 * 센터 소개·전화·주소·사진은 확인된 자료가 없어 비워 둔다.
 */
const ENTRIES = [
  {
    href: '/care',
    title: '요양보호사 로그인',
    note: '논문 연구용',
    tone: 'bg-[#3f6f5e] hover:bg-[#355e50] text-white',
  },
  {
    href: '/admin',
    title: '관리자·사회복지사 로그인',
    note: '논문 연구용',
    tone: 'bg-[#4d6478] hover:bg-[#42566a] text-white',
  },
  {
    href: '/office',
    title: '센터 업무 지원 시스템',
    note: '센터 대표·운영자 전용 · 로그인 필요',
    tone: 'bg-white hover:bg-[#f1efe9] text-[#2f3a36] border-2 border-[#c9c3b6]',
  },
] as const

export default function Landing() {
  const suffix = isDemoMode() ? '?demo=1' : ''
  return (
    <div className="min-h-dvh bg-[#f6f4ef] text-[#2f3a36] flex flex-col">
      <header className="px-4 pt-10 pb-6 text-center">
        <p className="text-sm font-semibold tracking-wide text-[#5b7a6e]">가드림365재가복지센터</p>
        <h1 className="mt-1 text-2xl font-bold">AI365 케어드림</h1>
      </header>
      <main className="flex-1 w-full max-w-md mx-auto px-4 pb-12 flex flex-col gap-4">
        {ENTRIES.map((entry) => (
          <a
            key={entry.href}
            href={entry.href + suffix}
            className={`block rounded-3xl px-6 py-7 shadow-sm transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#9cbcae] ${entry.tone}`}
          >
            <span className="block text-xl font-bold">{entry.title}</span>
            <span className="block mt-1 text-sm opacity-80">{entry.note}</span>
          </a>
        ))}
        {suffix && <p className="text-center text-xs font-bold text-amber-700">시연용 화면입니다. 실제 기록은 저장되지 않습니다.</p>}
      </main>
    </div>
  )
}
