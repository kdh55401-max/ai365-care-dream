import { useEffect, useRef } from 'react'
import { findResponseEvidence, type CenterRequestView } from '../../../shared/fieldRequests'
import { RESPONSE_STATUS_LABELS, type ResponseStatus } from '../../../shared/workflow'
import { emptyAnswer, type CenterAnswerDraft } from './centerAnswers'

/** 3단계 — 센터가 게시한 확인 요청을 현장 화면에 보여주고, 기존 보고 흐름 끝(보고 확인 화면)에서 답을 받는다.
 * - 요청 문구만 보인다(내부 메모·관리자 판단은 서버가 내려주지 않는다).
 * - 이미 말한 내용은 다시 묻지 않는다: 이번 보고 원문에서 같은 돌봄 영역 문장을 찾아 "이 내용으로 답하기"로 확인만 받는다.
 * - 기본값은 "이번에는 답하지 않음" — 요양보호사가 고르지 않으면 답을 만들지 않는다. */

function dueText(r: CenterRequestView): string {
  if (r.responseDueKind === 'next_actual_visit') return '다음 방문 때'
  if (r.responseDueKind === 'datetime' && r.responseDueAt) {
    const d = new Date(r.responseDueAt)
    return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} ${d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}까지`
  }
  return ''
}

/** 화면에 실제로 보인 요청만 "첫 표시"로 남긴다(같은 화면에서 한 번). */
function useMarkShown(requests: CenterRequestView[], onShown: (ids: string[]) => void) {
  const marked = useRef(new Set<string>())
  const ids = requests.map((r) => r.id).join(',')
  useEffect(() => {
    const fresh = requests.map((r) => r.id).filter((id) => !marked.current.has(id))
    if (fresh.length === 0) return
    fresh.forEach((id) => marked.current.add(id))
    onShown(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
}

/** 홈·기록 화면의 안내 — 이야기할 때 함께 담아 달라는 요청. */
export function CenterRequestNotice({ requests, onShown, compact = false }: { requests: CenterRequestView[]; onShown: (ids: string[]) => void; compact?: boolean }) {
  useMarkShown(requests, onShown)
  if (requests.length === 0) return null
  return (
    <section className="care-center-requests rounded-3xl border-2 border-sky-200 bg-sky-50 p-4 text-left" aria-label="센터 확인 요청">
      <p className="font-bold text-sky-900 text-base">센터 확인 요청 {requests.length}건</p>
      <ul className="mt-1 flex flex-col gap-1.5">
        {requests.map((r) => (
          <li key={r.id} className="text-slate-800 text-base leading-relaxed">
            “{r.message}”{dueText(r) && <span className="text-sky-800 text-sm font-semibold"> · {dueText(r)}</span>}
          </li>
        ))}
      </ul>
      {!compact && <p className="text-sky-800 text-sm mt-1.5">오늘 이야기할 때 함께 말씀해 주세요. 보고를 마칠 때 한 번 더 보여드려요.</p>}
    </section>
  )
}

const CHOICES: ResponseStatus[] = ['observed', 'performed', 'not_observed', 'refused', 'other']

/** 보고 확인 화면 — 요청별 답. 원문에서 찾은 문장은 요양보호사가 눌러야 답으로 쓴다. */
export function CenterRequestAnswers({
  requests,
  texts,
  answers,
  onChange,
  onShown,
  disabled,
}: {
  requests: CenterRequestView[]
  texts: string[]
  answers: Record<string, CenterAnswerDraft>
  onChange: (id: string, next: CenterAnswerDraft) => void
  onShown: (ids: string[]) => void
  disabled: boolean
}) {
  useMarkShown(requests, onShown)
  if (requests.length === 0) return null
  return (
    <section className="rounded-3xl border-2 border-sky-200 bg-sky-50 p-4" aria-label="센터 확인 요청에 대한 답">
      <p className="font-bold text-sky-900 text-base">센터 확인 요청에 대한 답</p>
      <p className="text-sm text-sky-800 mb-2">답은 이 보고와 함께 센터에 전달돼요. 모르거나 못 봤으면 그대로 두셔도 괜찮아요.</p>
      <div className="flex flex-col gap-3">
        {requests.map((r) => {
          const a = answers[r.id] ?? emptyAnswer()
          const evidence = findResponseEvidence(r.message, texts)
          const set = (patch: Partial<CenterAnswerDraft>) => onChange(r.id, { ...a, ...patch })
          return (
            <div key={r.id} className="rounded-2xl bg-white border border-sky-100 p-3" data-testid="center-request-answer">
              <p className="text-slate-900 text-base font-semibold">“{r.message}”</p>
              {evidence && (
                <div className="mt-2 rounded-xl bg-teal-50 border border-teal-100 p-2">
                  <p className="text-sm text-slate-700">방금 말씀하신 내용: “{evidence}”</p>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={a.useEvidence}
                    onClick={() => set(a.useEvidence ? { useEvidence: false, status: null } : { useEvidence: true, status: a.status ?? 'observed' })}
                    className={`mt-1.5 min-h-[44px] w-full rounded-xl text-base font-bold ${a.useEvidence ? 'bg-teal-600 text-white' : 'border-2 border-teal-600 text-teal-700 bg-white'}`}
                  >
                    {a.useEvidence ? '✓ 이 내용으로 답했어요' : '이 내용으로 답하기'}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-1.5 mt-2" role="radiogroup" aria-label="답 종류">
                {CHOICES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={a.status === s}
                    disabled={disabled}
                    onClick={() => set({ status: s })}
                    className={`min-h-[44px] rounded-xl border-2 text-base font-semibold px-3 text-left ${a.status === s ? 'bg-sky-700 border-sky-700 text-white' : 'border-slate-200 text-slate-800 bg-white'}`}
                  >
                    {RESPONSE_STATUS_LABELS[s]}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={a.status === null}
                  disabled={disabled}
                  onClick={() => set({ status: null, useEvidence: false })}
                  className={`min-h-[44px] rounded-xl border-2 text-base px-3 text-left ${a.status === null ? 'bg-slate-700 border-slate-700 text-white' : 'border-slate-200 text-slate-500 bg-white'}`}
                >
                  이번에는 답하지 않음
                </button>
              </div>
              {a.status !== null && (
                <textarea
                  value={a.text}
                  disabled={disabled}
                  onChange={(e) => set({ text: e.target.value })}
                  rows={2}
                  aria-label="덧붙일 말"
                  placeholder={a.status === 'other' && !a.useEvidence ? '어떤 상황이었는지 적어 주세요(필수)' : '덧붙일 말(선택)'}
                  className="mt-2 w-full rounded-xl border border-slate-200 p-2 text-base"
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
