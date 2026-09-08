import { useState, type ReactNode } from 'react'
import { navigate } from '../router'
import logo from '../assets/logo.png'
import RoleCard from './RoleCard'
import { CareIcon, CommunityIcon, TeamIcon } from './icons'
import { rememberRole, readLastRole, type RoleId } from './roleStorage'

interface RoleDef {
  id: RoleId
  path: string
  icon: ReactNode
  koreanName: string
  moduleName: string
  description: string
}

function RoleGateway() {
  const [lastRole] = useState<RoleId | null>(() => readLastRole())

  const roles: RoleDef[] = [
    {
      id: 'team',
      path: '/admin',
      icon: <TeamIcon className="w-7 h-7" />,
      koreanName: '관리자',
      moduleName: 'TEAM',
      description: '실증 현황·돌봄보고 확인',
    },
    {
      id: 'care',
      path: '/care',
      icon: <CareIcon className="w-7 h-7" />,
      koreanName: '요양보호사',
      moduleName: 'CARE',
      description: '오늘 돌봄보고 60초 작성',
    },
    {
      id: 'community',
      path: '/community',
      icon: <CommunityIcon className="w-7 h-7" />,
      koreanName: '생활지원사',
      moduleName: 'COMMUNITY',
      description: '대화형 생활안전 점검',
    },
  ]

  const handleSelect = (role: RoleDef) => {
    rememberRole(role.id)
    navigate(role.path)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-10">
      <header className="relative mb-8 text-center">
        <img
          src={logo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute -top-6 left-1/2 -translate-x-1/2
                     -z-10 w-56 opacity-[0.06]"
        />
        <p className="text-base font-semibold tracking-wide text-teal-600">AI365 CARE DREAM</p>
      </header>

      <main className="w-full max-w-md flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">어떤 업무를 시작할까요?</h1>
          <p className="text-slate-500 text-base mt-2 leading-relaxed">
            역할에 맞는 화면과 AI가 바로 연결됩니다.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              icon={role.icon}
              koreanName={role.koreanName}
              moduleName={role.moduleName}
              description={role.description}
              highlighted={lastRole === role.id}
              onClick={() => handleSelect(role)}
            />
          ))}
        </div>

        <p className="text-center text-slate-400 text-xs">
          최초 선택 후 이 기기에서 역할을 기억합니다.
        </p>
      </main>
    </div>
  )
}

export default RoleGateway
