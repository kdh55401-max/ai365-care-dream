import { useState } from 'react'
import WorkspaceHeader from '../roles/WorkspaceHeader'
import { CheckIcon, LockIcon } from '../roles/icons'
import {
  INITIAL_TEAM_TASKS,
  TEAM_CATEGORY_ORDER,
  type TeamPriority,
  type TeamTask,
} from './mockTeamData'

type TeamScreen = 'auth' | 'inbox' | 'detail' | 'done'

const PRIORITY_STYLES: Record<TeamPriority, { bubble: string; bar: string }> = {
  '일반 관찰': { bubble: 'bg-teal-50 text-teal-800 border-teal-200', bar: 'bg-teal-500' },
  '기관 확인 필요': { bubble: 'bg-orange-50 text-orange-800 border-orange-200', bar: 'bg-orange-500' },
  '우선 확인 필요': { bubble: 'bg-red-50 text-red-800 border-red-200', bar: 'bg-red-600' },
}

const STATUS_LABEL: Record<TeamTask['status'], string> = {
  pending: '확인 대기',
  approved: '승인 완료',
  revisionRequested: '보완 요청됨',
}

function TeamWorkspace() {
  const [screen, setScreen] = useState<TeamScreen>('auth')
  const [tasks, setTasks] = useState<TeamTask[]>(INITIAL_TEAM_TASKS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editedSummary, setEditedSummary] = useState('')
  const [revisionMode, setRevisionMode] = useState(false)
  const [revisionNote, setRevisionNote] = useState('')
  const [doneMessage, setDoneMessage] = useState('')

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null

  const handleAuth = () => setScreen('inbox')

  const openTask = (task: TeamTask) => {
    setSelectedId(task.id)
    setEditedSummary(task.aiSummary)
    setRevisionMode(false)
    setRevisionNote('')
    setScreen('detail')
  }

  const handleApprove = () => {
    if (!selectedTask) return
    setTasks((prev) =>
      prev.map((t) => (t.id === selectedTask.id ? { ...t, aiSummary: editedSummary, status: 'approved' } : t)),
    )
    setDoneMessage('기관 기록으로 저장되었습니다.')
    setScreen('done')
  }

  const handleRequestRevision = () => {
    if (!revisionMode) {
      setRevisionMode(true)
      return
    }
    if (!selectedTask || !revisionNote.trim()) return
    setTasks((prev) =>
      prev.map((t) =>
        t.id === selectedTask.id ? { ...t, status: 'revisionRequested', revisionNote: revisionNote.trim() } : t,
      ),
    )
    setDoneMessage('보완 요청을 현장 담당자에게 전달했습니다.')
    setScreen('done')
  }

  const backToInbox = () => {
    setSelectedId(null)
    setScreen('inbox')
  }

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8">
      <WorkspaceHeader moduleName="TEAM" title="관리자 업무공간" />

      <main className="relative w-full max-w-md flex-1">
        {screen === 'auth' && (
          <div className="flex flex-col items-center gap-6 pt-10">
            <div className="w-20 h-20 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center">
              <LockIcon className="w-9 h-9" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-900">관리자 인증</h2>
              <p className="text-slate-500 text-base mt-2 leading-relaxed">
                기관 업무함에 들어가려면 관리자 인증이 필요합니다.
              </p>
            </div>
            <button
              onClick={handleAuth}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4 hover:bg-teal-700 transition"
            >
              관리자로 인증하기
            </button>
            <p className="text-slate-400 text-xs text-center leading-relaxed">
              MVP 데모 인증입니다. 실제 계정·비밀번호 확인은 아직 연동되지 않았습니다.
            </p>
          </div>
        )}

        {screen === 'inbox' && (
          <div className="flex flex-col gap-6 pt-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">오늘 확인할 기관 업무입니다.</h2>
              <p className="text-slate-500 text-base mt-1">AI가 정리한 결과를 검토하고 승인합니다.</p>
            </div>

            {TEAM_CATEGORY_ORDER.map((category) => {
              const items = tasks.filter((t) => t.category === category)
              if (items.length === 0) return null
              return (
                <div key={category} className="flex flex-col gap-3">
                  <p className="text-slate-900 font-bold text-base flex items-center gap-2">
                    {category}
                    <span className="text-slate-400 text-sm font-semibold">{items.length}건</span>
                  </p>
                  <div className="flex flex-col gap-3">
                    {items.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => openTask(task)}
                        className="w-full min-h-[80px] rounded-3xl bg-white border border-slate-100 shadow-sm p-4
                                   text-left hover:border-teal-300 hover:shadow-md transition flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs font-bold rounded-full border px-2 py-0.5
                                        ${PRIORITY_STYLES[task.priority].bubble}`}
                          >
                            <span className={`w-2 h-2 rounded-full ${PRIORITY_STYLES[task.priority].bar}`} />
                            {task.priority}
                          </span>
                          {task.status !== 'pending' && (
                            <span className="text-slate-400 text-xs font-semibold">
                              {STATUS_LABEL[task.status]}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-900 font-bold text-lg leading-snug">{task.title}</p>
                        <p className="text-slate-400 text-sm">{task.subtitle}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {screen === 'detail' && selectedTask && (
          <div className="flex flex-col gap-4 pt-4">
            <span
              className={`self-start inline-flex items-center gap-1.5 text-sm font-bold rounded-full border px-3 py-1
                          ${PRIORITY_STYLES[selectedTask.priority].bubble}`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${PRIORITY_STYLES[selectedTask.priority].bar}`} />
              {selectedTask.priority}
            </span>

            <h2 className="text-xl font-bold text-slate-900">{selectedTask.title}</h2>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <h3 className="font-bold text-slate-900 text-base mb-2">현장 원문·보고 내용</h3>
              <p className="text-slate-700 text-base leading-relaxed">{selectedTask.rawReport}</p>
            </div>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <h3 className="font-bold text-slate-900 text-base mb-2">AI가 정리한 내용 (수정 가능)</h3>
              <textarea
                value={editedSummary}
                onChange={(e) => setEditedSummary(e.target.value)}
                rows={4}
                className="w-full text-base text-slate-900 leading-relaxed focus:outline-none resize-none"
              />
            </div>

            {revisionMode && (
              <div className="rounded-3xl bg-orange-50 border border-orange-100 p-5">
                <h3 className="font-bold text-slate-900 text-base mb-2">보완 요청 내용</h3>
                <textarea
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  placeholder="현장 담당자에게 추가로 확인·보완이 필요한 내용을 적어주세요."
                  rows={3}
                  className="w-full text-base text-slate-900 leading-relaxed focus:outline-none resize-none
                             placeholder:text-slate-400"
                />
              </div>
            )}

            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={handleApprove}
                className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4
                           hover:bg-teal-700 transition"
              >
                승인
              </button>
              <button
                onClick={handleRequestRevision}
                disabled={revisionMode && !revisionNote.trim()}
                className="w-full min-h-[52px] rounded-full border-2 border-orange-400 text-orange-600 bg-white
                           text-xl font-bold py-4 hover:bg-orange-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {revisionMode ? '보완 요청 보내기' : '보완 요청'}
              </button>
              <button
                onClick={backToInbox}
                className="text-slate-400 text-base hover:text-slate-600 transition self-center"
              >
                업무함으로 돌아가기
              </button>
            </div>
          </div>
        )}

        {screen === 'done' && (
          <div className="flex flex-col items-center gap-6 pt-16 text-center">
            <div className="w-16 h-16 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center">
              <CheckIcon className="w-8 h-8" />
            </div>
            <p className="text-slate-900 text-xl font-bold leading-relaxed">{doneMessage}</p>
            <button
              onClick={backToInbox}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4
                         hover:bg-teal-700 transition"
            >
              업무함으로 돌아가기
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

export default TeamWorkspace
