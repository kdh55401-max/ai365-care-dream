/** 돌봄 AI의 시각적 "존재감"을 나타내는 아바타. 사람이나 동물 형상, 표정(눈·입)을
 * 넣지 않는다 — 의료인 등 실제 자격을 가진 사람으로 오인되거나, 유아용/게임/동물
 * 캐릭터처럼 보이는 것을 피하기 위해 의도적으로 완전히 추상적인 형태(그라디언트
 * 원 + 상태별 링 애니메이션)만 쓴다. 상태는 실제 앱 상태(듣는 중/처리 중/질문/
 * 완료/오류)와 그대로 연결되며, 이 컴포넌트 자체는 새로운 상태를 만들지 않는다 —
 * 호출부가 실제 상태를 그대로 넘긴다. */
export type AvatarState = 'idle' | 'listening' | 'processing' | 'question' | 'reviewing' | 'sending' | 'done' | 'error'

function MicGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function AlertGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 9v4M12 16.5h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
function DotsGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="6" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}

const STATE_RING_COLOR: Record<AvatarState, string> = {
  idle: 'border-teal-300/60',
  listening: 'border-red-300/70',
  processing: 'border-amber-300/70',
  question: 'border-teal-300/60',
  reviewing: 'border-teal-300/60',
  sending: 'border-amber-300/70',
  done: 'border-teal-300/70',
  error: 'border-red-300/70',
}

const STATE_CORE_GRADIENT: Record<AvatarState, string> = {
  idle: 'from-teal-500 to-slate-900',
  listening: 'from-red-400 to-slate-900',
  processing: 'from-amber-400 to-slate-900',
  question: 'from-teal-500 to-slate-900',
  reviewing: 'from-teal-500 to-slate-900',
  sending: 'from-amber-400 to-slate-900',
  done: 'from-teal-500 to-teal-700',
  error: 'from-red-500 to-slate-900',
}

/** 사람이 읽을 상태 문구 — 화면마다 다시 정의하지 않도록 한 곳에 모아 둔다.
 * 실제 상태 변수(voice.state/loading/screen 등)와의 매핑은 호출부 책임이다. */
export const AVATAR_STATE_LABEL: Record<AvatarState, string> = {
  idle: '눌러서 말씀해주세요',
  listening: '듣고 있어요',
  processing: '말씀하신 내용을 확인하고 있어요',
  question: '질문에 답해주세요',
  reviewing: '기록을 확인해주세요',
  sending: '센터로 보내는 중이에요',
  done: '완료됐어요',
  error: '문제가 생겼어요',
}

/** 순수 시각 요소다 — 클릭 가능 여부와 라벨은 호출부가 이 컴포넌트를 감싼
 * <button>/<div> 쪽 책임으로 둔다("아바타 영역과 '이야기 시작' 버튼을 하나의
 * 시작 동작으로 연결"하려면 버튼 하나 안에 아바타+글자를 함께 넣는 편이,
 * 아바타 자체에 onClick을 감추는 것보다 "이게 눌린다"는 것을 더 분명히 만든다). */
export function AiAvatar({ state, size = 'lg' }: { state: AvatarState; size?: 'lg' | 'sm' }) {
  const dimClass = size === 'lg' ? 'w-40 h-40' : 'w-14 h-14'
  const iconClass = size === 'lg' ? 'w-9 h-9' : 'w-5 h-5'
  const Glyph =
    state === 'done'
      ? CheckGlyph
      : state === 'error'
        ? AlertGlyph
        : state === 'processing' || state === 'sending'
          ? DotsGlyph
          : MicGlyph

  const core = (
    <div
      className={`relative ${dimClass} rounded-full flex items-center justify-center text-white
                  bg-gradient-to-b ${STATE_CORE_GRADIENT[state]} shadow-xl transition-colors duration-300`}
    >
      {/* 듣는 중: 바깥으로 번지는 링(사람 목소리에 반응하고 있다는 인상) */}
      {state === 'listening' && (
        <>
          <span className={`absolute inset-0 rounded-full border-2 ${STATE_RING_COLOR[state]} animate-ping`} />
          <span
            className={`absolute -inset-2 rounded-full border-2 ${STATE_RING_COLOR[state]} animate-ping`}
            style={{ animationDelay: '0.3s' }}
          />
        </>
      )}
      {/* 처리/전송 중: 궤도를 도는 얇은 링(생각/작업 중이라는 인상, 사람 얼굴 대신) */}
      {(state === 'processing' || state === 'sending') && (
        <span className={`absolute -inset-1.5 rounded-full border-2 border-t-transparent ${STATE_RING_COLOR[state]} animate-spin`} />
      )}
      <Glyph className={iconClass} />
    </div>
  )

  return core
}
