import { useLayoutEffect, useRef } from 'react'
import { AvatarVideo } from './AvatarVideo'

export type AvatarState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'question' | 'reviewing' | 'sending' | 'done' | 'error'
export const AVATAR_STATE_LABEL: Record<AvatarState, string> = {
  idle: '편하게 이야기해주세요', connecting: '마이크를 연결하고 있어요', listening: '듣고 있어요', processing: '내용을 확인하고 있어요',
  speaking: '말씀드리고 있어요', question: '질문에 답해주세요', reviewing: '기록을 확인해주세요',
  sending: '센터에 보고하는 중이에요', done: '기록을 남겼어요', error: '잠시 확인해주세요',
}

/** 실제 생성한 무음 인사/대기 영상. 같은 DOM과 기존 이동 동작을 유지하며 립싱크는 없다. */
export function AiAvatar({ state, size = 'lg' }: { state: AvatarState; size?: 'lg' | 'sm' }) {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef<DOMRect | null>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const next = node.getBoundingClientRect()
    const before = previous.current
    previous.current = next
    if (!before || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = node.animate([
      { transform: 'translate(' + (before.left - next.left) + 'px, ' + (before.top - next.top) + 'px) scale(' + before.width / next.width + ')' },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: 620, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    return () => animation.cancel()
  }, [size])
  return (
    <div ref={ref} className={'companion-portrait companion-portrait--' + size} data-testid="companion-avatar" data-state={state}>
      <AvatarVideo home={size === 'lg'} />
    </div>
  )
}

export function CompanionHeader({ expanded, state, recipientCode, completed, audioControl }: {
  expanded: boolean; state: AvatarState; recipientCode: string; completed: boolean; audioControl: React.ReactNode
}) {
  return (
    <header className={'companion-header ' + (expanded ? 'companion-header--expanded' : 'companion-header--compact')}>
      <div className="companion-greeting" hidden={!expanded}>
        <p className="companion-eyebrow">AI365 CARE DREAM · AI 돌봄 동료</p>
        <h1>{completed ? '오늘도 함께 돌봤어요' : '오늘 ' + (recipientCode || '배정된') + ' 어르신은 어떠셨어요?'}</h1>
        <p>평소와 같아도 괜찮아요.<br />돌봄 이야기를 편하게 들려주세요.</p>
      </div>
      <AiAvatar state={state} size={expanded ? 'lg' : 'sm'} />
      <div className="companion-caption">
        <p className="companion-identity">AI 돌봄 동료{!expanded && recipientCode ? ' · ' + recipientCode + ' 어르신' : ''}</p>
        <p className="companion-state" role="status" aria-live="polite" data-testid="companion-state">
          <span className={'companion-signal companion-signal--' + state} aria-hidden="true" />
          {expanded && state === 'idle' ? '이야기할 준비 됐어요' : AVATAR_STATE_LABEL[state]}
        </p>
      </div>
      <div className="companion-audio">{audioControl}</div>
    </header>
  )
}
