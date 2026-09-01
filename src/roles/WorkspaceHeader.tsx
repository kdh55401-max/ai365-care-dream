import { navigate } from '../router'

interface WorkspaceHeaderProps {
  moduleName: string
  title: string
}

/** 관리자(TEAM)·요양보호사(CARE) 업무공간 공통 상단 헤더.
 * 생활지원사(COMMUNITY)는 기존 App.tsx 자체 헤더를 유지하고 역할 전환
 * 버튼만 그 헤더에 추가했다(App.tsx 참고). */
function WorkspaceHeader({ moduleName, title }: WorkspaceHeaderProps) {
  return (
    <header className="mb-6 w-full max-w-md mx-auto pt-1">
      <div className="flex items-start justify-between gap-2">
        <span className="w-14 shrink-0" aria-hidden="true" />
        <div className="text-center flex-1 min-w-0">
          <p className="text-base font-semibold tracking-wide text-teal-600">AI365 CARE DREAM</p>
          <p className="text-teal-700 text-xs font-bold tracking-widest mt-0.5">{moduleName}</p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="w-14 shrink-0 text-right text-slate-400 hover:text-slate-600 text-sm py-1 leading-tight"
        >
          역할
          <br />
          전환
        </button>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mt-1 text-center">{title}</h1>
    </header>
  )
}

export default WorkspaceHeader
