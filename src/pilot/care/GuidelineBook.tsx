import { useEffect, useRef, useState } from 'react'

/**
 * 급여제공지침서(센터 비치서류 1번, 12개 지침) 책 보기.
 * 요양보호사가 대화 중 궁금한 것이 생기면 책 버튼 → 지침 고르기 → 쪽 넘겨 읽기.
 * 원본 PDF(대부분 스캔본)를 쪽마다 이미지(public/guidelines/NN/NNN.webp)로 바꿔 휴대폰에서도 바로 열린다.
 */
const GUIDELINES = [
  { n: 1, title: '종사자 윤리지침', pages: 8 },
  { n: 2, title: '성폭력 예방 및 대응지침', pages: 8 },
  { n: 3, title: '응급상황 대응지침', pages: 12 },
  { n: 4, title: '감염예방 및 관리지침', pages: 16 },
  { n: 5, title: '치매예방 및 관리지침', pages: 12 },
  { n: 6, title: '욕창예방 및 관리지침', pages: 8 },
  { n: 7, title: '낙상예방 및 관리지침', pages: 8 },
  { n: 8, title: '노인인권 보호지침', pages: 10 },
  { n: 9, title: '근골격계 예방지침', pages: 18 },
  { n: 10, title: '개인정보 보호지침', pages: 7 },
  { n: 11, title: '직원 인권침해 대응지침', pages: 10 },
  { n: 12, title: '고충처리지침', pages: 5 },
] as const

const pad = (v: number, len: number) => String(v).padStart(len, '0')
const pageSrc = (n: number, page: number) => `/guidelines/${pad(n, 2)}/${pad(page, 3)}.webp`

function BookIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="M9 7h7M9 10.5h5" />
    </svg>
  )
}

/** 대화 화면 위에 두는 책 버튼. 누르면 지침서 책장이 열린다. */
export function GuidelineButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className={'flex items-center gap-1.5 rounded-full border border-brand bg-white px-3 py-2 text-sm font-bold text-brand hover:bg-brand-tint ' + className}>
        <BookIcon /> 지침서
      </button>
      {open && <GuidelineBook onClose={() => setOpen(false)} />}
    </>
  )
}

export function GuidelineBook({ onClose }: { onClose: () => void }) {
  const [book, setBook] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const touchX = useRef<number | null>(null)
  const current = GUIDELINES.find((g) => g.n === book)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0, left: 0 }) }, [book, page])

  const go = (delta: number) => {
    if (!current) return
    const next = page + delta
    if (next >= 1 && next <= current.pages) setPage(next)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (book) setBook(null); else onClose() }
      if (book && e.key === 'ArrowRight') go(1)
      if (book && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div role="dialog" aria-modal="true" aria-label="급여제공지침서" className="fixed inset-0 z-50 flex flex-col bg-[#f4f1ea]">
      <header className="flex items-center gap-2 border-b border-[#e2dccf] bg-white px-4 h-14 shrink-0">
        {current ? (
          <button type="button" onClick={() => { setBook(null); setZoom(false) }} className="text-sm font-bold text-brand">← 목차</button>
        ) : (
          <span className="flex items-center gap-1.5 text-brand"><BookIcon /></span>
        )}
        <p className="flex-1 truncate text-[15px] font-bold text-[#111827]">{current ? `${current.n}. ${current.title}` : '급여제공지침서'}</p>
        <button type="button" onClick={onClose} className="rounded-full border border-[#d1d5db] px-3 py-1.5 text-sm font-bold text-[#374151]">닫기</button>
      </header>

      {!current ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-5">
            <p className="text-sm font-medium text-[#4b5563]">가드림365재가복지센터 · 신규직원 필수 숙지</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.02em]">급여제공지침서 12권</h2>
            <p className="mt-1 text-[15px] text-[#374151]">읽을 지침을 누르세요. 쪽은 옆으로 밀거나 아래 버튼으로 넘깁니다.</p>
            <ul className="mt-5 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4">
              {GUIDELINES.map((g) => (
                <li key={g.n}>
                  <button type="button" onClick={() => { setBook(g.n); setPage(1) }} aria-label={`${g.n}. ${g.title}, ${g.pages}쪽`}
                    className="group relative block w-full aspect-[3/4] overflow-hidden rounded-r-md rounded-l-sm bg-brand text-left text-white shadow-[4px_6px_12px_rgba(17,24,39,0.25)] transition-transform hover:-translate-y-1 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#93b4f5]">
                    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2.5 bg-[#071f4a]" />
                    <span aria-hidden="true" className="absolute inset-y-0 left-2.5 w-px bg-white/25" />
                    <span className="absolute left-5 right-2 top-3 font-brand text-xl font-semibold">{pad(g.n, 2)}</span>
                    <span className="absolute left-5 right-2 bottom-8 text-[13px] font-bold leading-snug break-keep">{g.title}</span>
                    <span className="absolute left-5 bottom-2.5 text-[11px] text-[#c9d6ef]">{g.pages}쪽</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-auto"
            onTouchStart={(e) => { if (!zoom) touchX.current = e.touches[0].clientX }}
            onTouchEnd={(e) => {
              if (zoom || touchX.current === null) return
              const dx = e.changedTouches[0].clientX - touchX.current
              touchX.current = null
              if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1)
            }}>
            <div className={zoom ? 'w-[200%] p-2' : 'mx-auto max-w-2xl p-3'}>
              <img key={`${current.n}-${page}`} src={pageSrc(current.n, page)} alt={`${current.title} ${page}쪽`}
                className="w-full h-auto bg-white shadow-[0_2px_10px_rgba(17,24,39,0.15)]" draggable={false} />
            </div>
            {page < current.pages && <link rel="prefetch" href={pageSrc(current.n, page + 1)} />}
          </div>
          <footer className="flex items-center gap-2 border-t border-[#e2dccf] bg-white px-3 py-2 shrink-0">
            <button type="button" onClick={() => go(-1)} disabled={page <= 1}
              className="h-12 flex-1 border border-[#111827] font-bold disabled:border-[#d1d5db] disabled:text-[#9ca3af]">이전 쪽</button>
            <p className="w-20 text-center text-[15px] font-bold" aria-live="polite">{page} / {current.pages}</p>
            <button type="button" onClick={() => go(1)} disabled={page >= current.pages}
              className="h-12 flex-1 bg-brand font-bold text-white disabled:bg-[#9ca3af]">다음 쪽</button>
            <button type="button" onClick={() => setZoom((z) => !z)} aria-pressed={zoom}
              className="h-12 px-3 border border-[#d1d5db] text-sm font-bold text-[#374151]">{zoom ? '맞춤' : '크게'}</button>
          </footer>
        </>
      )}
    </div>
  )
}
