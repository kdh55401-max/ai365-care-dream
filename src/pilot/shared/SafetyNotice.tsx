import { CENTER_MOBILE, CENTER_PHONE, telHref } from './centerContact'

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

/** 모든 /care 화면 상단에 고정 노출하는 센터 전화·센터 휴대폰·119 버튼. */
export function TopCallBar() {
  const base = 'flex-1 flex flex-col items-center justify-center min-h-[48px] rounded-2xl text-sm font-bold py-1.5 transition'
  return (
    <div className="flex gap-2 w-full max-w-md mx-auto mb-3">
      <a href={telHref(CENTER_PHONE)} aria-label={'센터 전화 ' + CENTER_PHONE}
        className={base + ' bg-white border-2 border-brand text-brand hover:bg-brand-tint'}>
        <span className="flex items-center gap-1"><PhoneIcon className="w-4 h-4" />센터 전화</span>
        <span className="text-[11px] font-medium">{CENTER_PHONE}</span>
      </a>
      <a href={telHref(CENTER_MOBILE)} aria-label={'센터 휴대폰 ' + CENTER_MOBILE}
        className={base + ' bg-white border-2 border-brand text-brand hover:bg-brand-tint'}>
        <span className="flex items-center gap-1"><PhoneIcon className="w-4 h-4" />센터 휴대폰</span>
        <span className="text-[11px] font-medium">{CENTER_MOBILE}</span>
      </a>
      <a href="tel:119" className={base + ' bg-red-600 text-white hover:bg-red-700'}>
        <span className="flex items-center gap-1"><PhoneIcon className="w-4 h-4" />119</span>
        <span className="text-[11px] font-medium">응급</span>
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
