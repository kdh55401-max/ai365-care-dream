import { useEffect, useRef } from 'react'
export interface ConversationTurn { role: 'ai' | 'user'; text: string }
/** 실제 입력/응답 이력. 페이지 자체를 스크롤하지 않고 로그 안에서만 최신 발화를 보여준다. */
export function ConversationLog({ turns }: { turns: ConversationTurn[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [turns.length])
  if (!turns.length) return null
  return (
    <div ref={ref} className="conversation-log" aria-label="주고받은 이야기" role="log" aria-live="polite">
      {turns.map((turn, i) => (
        <div key={i} className={'conversation-turn conversation-turn--' + turn.role}>
          <span className="conversation-speaker">{turn.role === 'user' ? '나' : 'AI 돌봄 동료'}</span>
          <p className="conversation-bubble">{turn.text}</p>
        </div>
      ))}
    </div>
  )
}
