const CENTER_PHONE = import.meta.env.VITE_CENTER_PHONE_NUMBER?.trim() || undefined

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

/** 모든 /care 화면 상단에 고정 노출하는 센터/119 전화 버튼. */
export function TopCallBar() {
  return (
    <div className="flex gap-2 w-full max-w-md mx-auto mb-3">
      {CENTER_PHONE ? (
        <a
          href={`tel:${CENTER_PHONE}`}
          className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-2xl
                     bg-white border-2 border-slate-900 text-slate-900 text-sm font-bold py-2
                     hover:bg-slate-50 transition"
        >
          <PhoneIcon className="w-4 h-4" />
          센터 전화
        </a>
      ) : (
        <span className="flex-1 flex items-center justify-center min-h-[44px] rounded-2xl border-2 border-slate-200 text-slate-400 text-sm">
          센터 번호 미등록
        </span>
      )}
      <a
        href="tel:119"
        className="flex-1 flex items-center justify-center gap-1.5 min-h-[44px] rounded-2xl
                   bg-red-600 text-white text-sm font-bold py-2 hover:bg-red-700 transition"
      >
        <PhoneIcon className="w-4 h-4" />
        119 전화
      </a>
    </div>
  )
}

/** 모든 화면 하단에 고정 노출하는 안전 고지. */
export function SafetyFooter() {
  return (
    <p className="w-full max-w-md mx-auto text-center text-[11px] leading-relaxed text-slate-400 mt-6 px-2">
      AI365 CARE DREAM은 의료진단을 제공하지 않습니다. 의식저하, 심한 호흡곤란 등 즉각적인 위험이
      의심되면 AI 답변을 기다리지 말고 119와 센터에 연락하세요.
    </p>
  )
}

export function PrivacyNotice() {
  return (
    <p className="w-full max-w-md mx-auto text-center text-[11px] leading-relaxed text-slate-400 mt-2 px-2">
      실명·주소·전화번호 등 개인정보는 말하거나 입력하지 마세요. 이 화면의 내용은 실증 목적으로만
      사용되며 가명 코드로 관리됩니다.
    </p>
  )
}
