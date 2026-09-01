/** 역할 선택 화면 전용 아이콘. 기존 App.tsx/safetyScanner의 인라인 SVG 스타일을 그대로 따른다. */

export function TeamIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M3 12.5h18M11 12.5v1.6a1 1 0 0 0 1 1h0a1 1 0 0 0 1-1v-1.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function CareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 19.5s-6.7-4.1-8.7-8C1.9 8.2 3.2 5 6.4 5c1.9 0 3.1 1.1 3.8 2.2C10.9 6.1 12.1 5 14 5c3.2 0 4.5 3.2 3.1 6.5-2 3.9-8.7 8-8.7 8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 11h2.3l1.3-2.4L10.8 13l1.2-2h5.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CommunityIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="9" cy="8.2" r="2.7" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.2 19c.3-3.1 2.7-5 5.8-5s5.5 1.9 5.8 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="17" cy="9" r="2.1" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M15.6 19c.2-2.3 1.7-3.9 3.6-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 10.5V8a4 4 0 0 1 8 0v2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14.7" r="1.3" fill="currentColor" />
    </svg>
  )
}

export function NfcIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M7 9a5 5 0 0 1 7 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.3 6.3a9 9 0 0 1 12.6 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8.3" cy="15.7" r="2" fill="currentColor" />
    </svg>
  )
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8z"
        fill="currentColor"
      />
    </svg>
  )
}

export function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
