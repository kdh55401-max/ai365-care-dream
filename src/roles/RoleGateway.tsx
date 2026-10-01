import { useState, type ReactNode } from 'react'
import { navigate } from '../router'
import logo from '../assets/logo.png'
import RoleCard from './RoleCard'
import { CareIcon, TeamIcon } from './icons'
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
      description: '수급자 등록·관리와 기록 검토',
    },
    {
      id: 'care',
      path: '/care',
      icon: <CareIcon className="w-7 h-7" />,
      koreanName: '요양보호사',
      moduleName: 'CARE',
      description: '말로 남기는 오늘의 급여 기록',
    },
  ]

  const handleSelect = (role: RoleDef) => {
    rememberRole(role.id)
    // 데모(?demo=1)로 들어온 방문자가 역할을 고른 뒤에도 데모 모드가 풀리지
    // 않도록 현재 쿼리스트링을 그대로 이어 붙인다 — 그대로 두면 각 역할
    // 화면(CareApp/AdminApp)의 isDemoMode()가 false로 떨어져 운영 로그인
    // 화면으로 전환된다.
    navigate(`${role.path}${window.location.search}`)
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
        <p className="text-slate-500 text-xs mt-1">방문요양 기관 업무 시스템</p>
      </header>

      <main className="w-full max-w-md flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">누가 사용하시나요?</h1>
          <p className="text-slate-500 text-base mt-2 leading-relaxed">
            맡은 업무에 맞는 화면으로 들어갑니다.
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
          마지막에 사용한 역할이 이 기기에 표시됩니다.
        </p>
      </main>
    </div>
  )
}

export default RoleGateway
