import type { ReactNode } from 'react'
import { ChevronRightIcon } from './icons'

interface RoleCardProps {
  icon: ReactNode
  koreanName: string
  moduleName: string
  description: string
  highlighted?: boolean
  onClick: () => void
}

/** 역할 선택 화면의 카드 하나. 카드 전체가 클릭 가능한 버튼이다. */
function RoleCard({ icon, koreanName, moduleName, description, highlighted, onClick }: RoleCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full min-h-[80px] rounded-3xl border-2 bg-white p-5 flex items-center gap-4
                  text-left transition hover:shadow-md
                  ${highlighted ? 'border-teal-500 shadow-md' : 'border-slate-100 shadow-sm hover:border-teal-300'}`}
    >
      <span className="shrink-0 w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-xl font-bold text-slate-900">{koreanName}</span>
          <span className="text-xs font-bold tracking-wide text-teal-700 bg-teal-50 rounded-full px-2 py-0.5">
            {moduleName}
          </span>
        </span>
        <span className="block text-slate-500 text-sm mt-1 leading-relaxed">{description}</span>
      </span>
      <ChevronRightIcon className="w-6 h-6 shrink-0 text-slate-300" />
    </button>
  )
}

export default RoleCard
