import { useEffect, useRef } from 'react'

/** 실제로 오간 발화만 담는다 — 예시나 가상의 대화를 채워 넣지 않는다. 호출부가
 * rawInput/followupHistory 등 실제 상태에서 그대로 만들어 넘긴다. */
export interface ConversationTurn {
  role: 'ai' | 'user'
  text: string
}

/** 대화 화면 상단의 채팅 형태 기록. 새 발화가 추가되면 자동으로 맨 아래로
 * 스크롤한다. 너무 길어지지 않도록 스스로 높이를 제한하고 내부 스크롤을 쓴다 —
 * 페이지 전체 가로/세로 스크롤에 영향을 주지 않는다. */
export function ConversationLog({ turns }: { turns: ConversationTurn[] }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns.length])

  if (turns.length === 0) return null

  return (
    <div className="w-full max-h-64 overflow-y-auto rounded-3xl bg-white border border-slate-100 shadow-sm p-4 flex flex-col gap-3">
      {turns.map((turn, i) => (
        <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <p
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${
              turn.role === 'user' ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'
            }`}
          >
            {turn.text}
          </p>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
