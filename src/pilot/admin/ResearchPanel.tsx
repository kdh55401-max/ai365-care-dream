/**
 * 관리자 "주간 상태변화(연구)" 화면.
 * 1) 한 주(월~일) 동안 요양보호사별·어르신별 하루 기록 추이를 한눈에 본다.
 * 2) 한 쌍(요양보호사·어르신)을 열면 원자료 전사본 / AI 초안 / 요양보호사 수정본을 나란히 본다.
 * 3) 관리자가 확정본을 고쳐 확정하고, 상담·후속조치를 기록한다. 각 판본은 서로 덮어쓰지 않는다.
 * 이 화면은 AI를 부르지 않는다.
 */
import { useEffect, useMemo, useState } from 'react'
import { ApiClientError } from '../shared/api'
import type { WeeklyDraft } from '../shared/researchRepo'
import { realResearchAdminRepo, type ResearchAdminRepo, type ResearchDay, type ResearchWeek } from '../shared/researchAdminRepo'
import { demoResearchAdminRepo } from '../demo/demoResearchAdminRepo'
import { addDays, isNoChangeDay, transcriptText, weekStartOf } from '../../../shared/researchCare'

type GroupBy = 'caregiver' | 'recipient'
const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
function errorText(e: unknown): string {
  const status = e instanceof ApiClientError ? e.status : 0
  if (status === 401) return '관리자 로그인이 만료됐어요. 다시 로그인해 주세요.'
  return e instanceof Error && e.message ? e.message : '불러오지 못했어요. 다시 시도해 주세요.'
}
const pairKey = (c: string, r: string) => `${c}|${r}`

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  none: { text: '주간 기록 없음', tone: 'bg-slate-100 text-slate-500' },
  draft: { text: '요양보호사 확인 중', tone: 'bg-amber-50 text-amber-700' },
  sent: { text: '검토 대기', tone: 'bg-sky-50 text-sky-700' },
  confirmed: { text: '확정', tone: 'bg-brand-tint text-brand' },
}

export function ResearchPanel({ demo }: { demo: boolean }) {
  const repo: ResearchAdminRepo = demo ? demoResearchAdminRepo : realResearchAdminRepo
  const thisWeek = weekStartOf(todayKst())
  const [week, setWeek] = useState(thisWeek)
  const [data, setData] = useState<ResearchWeek | null>(null)
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('caregiver')
  const [selected, setSelected] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    repo.week(week)
      .then((d) => { if (active) { setData(d); setError(null) } })
      .catch((e) => { if (active) { setData(null); setError(errorText(e)) } })
      .finally(() => { if (active) setLoadedWeek(week) })
    return () => { active = false }
  }, [repo, week, reload])

  const days = DAY_NAMES.map((_, i) => addDays(week, i))

  const pairs = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { caregiver: string; recipient: string; byDay: Record<string, ResearchDay[]>; weekly: WeeklyDraft | null }>()
    const ensure = (c: string, r: string) => {
      const k = pairKey(c, r)
      if (!map.has(k)) map.set(k, { caregiver: c, recipient: r, byDay: {}, weekly: null })
      return map.get(k)!
    }
    for (const d of data.reports) (ensure(d.participant_code, d.recipient_code).byDay[d.report_date] ??= []).push(d)
    for (const w of data.weeklies) ensure(w.participant_code, w.recipient_code).weekly = w
    return [...map.values()].sort((a, b) => groupBy === 'caregiver'
      ? a.caregiver.localeCompare(b.caregiver) || a.recipient.localeCompare(b.recipient)
      : a.recipient.localeCompare(b.recipient) || a.caregiver.localeCompare(b.caregiver))
  }, [data, groupBy])

  const summary = useMemo(() => {
    const reports = data?.reports ?? []
    const secs = reports.map((r) => r.completion_seconds).filter((s): s is number => typeof s === 'number')
    const weeklies = data?.weeklies ?? []
    return {
      days: reports.length,
      caregivers: new Set(reports.map((r) => r.participant_code)).size,
      changed: reports.filter((r) => !isNoChangeDay(r.raw_input)).length,
      avgSec: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null,
      waiting: weeklies.filter((w) => w.status === 'sent').length,
      confirmed: weeklies.filter((w) => w.status === 'confirmed').length,
    }
  }, [data])

  const current = pairs.find((p) => pairKey(p.caregiver, p.recipient) === selected) ?? null
  const loading = loadedWeek !== week
  const groupLabel = (p: { caregiver: string; recipient: string }) => groupBy === 'caregiver' ? p.caregiver : p.recipient
  const otherLabel = (p: { caregiver: string; recipient: string }) => groupBy === 'caregiver' ? `${p.recipient} 어르신` : `요양보호사 ${p.caregiver}`

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => { setSelected(null); setWeek(addDays(week, -7)) }} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold">◀ 이전 주</button>
          <p className="font-bold text-slate-900">{week.slice(5).replace('-', '/')} (월) ~ {addDays(week, 6).slice(5).replace('-', '/')} (일)</p>
          <button disabled={week >= thisWeek} onClick={() => { setSelected(null); setWeek(addDays(week, 7)) }} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold disabled:opacity-40">다음 주 ▶</button>
        </div>
        <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="group" aria-label="묶는 기준">
          {(['caregiver', 'recipient'] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)} aria-pressed={groupBy === g}
              className={`rounded-full px-3 py-1 text-sm font-bold ${groupBy === g ? 'bg-white text-brand shadow-sm' : 'text-slate-500'}`}>
              {g === 'caregiver' ? '요양보호사별' : '어르신별'}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
      {data && !data.weeklyReady && (
        <p className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">주간 기록 저장소(DB)가 아직 준비되지 않아 하루 기록만 보입니다.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          ['하루 기록', `${summary.days}건`],
          ['참여 요양보호사', `${summary.caregivers}명`],
          ['변화를 말한 기록', `${summary.changed}건`],
          ['평균 작성 시간', summary.avgSec === null ? '-' : `${summary.avgSec}초`],
          ['주간 기록 검토 대기 / 확정', `${summary.waiting} / ${summary.confirmed}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white border border-slate-200 p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-lg font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-slate-500 text-xs">
              <th className="text-left p-2">{groupBy === 'caregiver' ? '요양보호사' : '어르신'}</th>
              <th className="text-left p-2">{groupBy === 'caregiver' ? '어르신' : '요양보호사'}</th>
              {days.map((d, i) => <th key={d} className="p-2 text-center">{DAY_NAMES[i]}<br /><span className="font-normal">{d.slice(8)}</span></th>)}
              <th className="p-2 text-left">주간 기록</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="p-4 text-center text-slate-500">불러오는 중…</td></tr>}
            {!loading && pairs.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-slate-500">이 주에 저장된 기록이 없습니다.</td></tr>}
            {!loading && pairs.map((p, idx) => {
              const k = pairKey(p.caregiver, p.recipient)
              const st = STATUS_LABEL[p.weekly?.status ?? 'none']
              const firstOfGroup = idx === 0 || groupLabel(pairs[idx - 1]) !== groupLabel(p)
              return (
                <tr key={k} className={`border-t border-slate-100 ${selected === k ? 'bg-brand-tint' : ''}`}>
                  <td className="p-2 font-bold">{firstOfGroup ? groupLabel(p) : ''}</td>
                  <td className="p-2">{otherLabel(p)}</td>
                  {days.map((d) => {
                    const list = p.byDay[d] ?? []
                    const changed = list.some((r) => !isNoChangeDay(r.raw_input))
                    return (
                      <td key={d} className="p-1 text-center">
                        {list.length === 0 ? <span className="text-slate-300">·</span> : (
                          <span title={list.map((r) => r.raw_input).join(' / ')}
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${changed ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                            {changed ? '변화' : '평소'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td className="p-2">
                    <button onClick={() => setSelected(selected === k ? null : k)} className={`rounded-full px-3 py-1 text-xs font-bold ${st.tone}`}>
                      {st.text} · 열기
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 pb-2 text-xs text-slate-500">"평소"는 요양보호사가 특이사항 없음이라고 말한 날, "변화"는 그 밖의 내용을 말한 날입니다(말한 표현 기준이며 의학적 판단이 아닙니다).</p>
      </div>

      {current && (
        <PairReview key={selected} repo={repo} pair={current}
          onSaved={() => setReload((n) => n + 1)} />
      )}
    </section>
  )
}

function PairReview({ repo, pair, onSaved }: {
  repo: ResearchAdminRepo
  pair: { caregiver: string; recipient: string; byDay: Record<string, ResearchDay[]>; weekly: WeeklyDraft | null }
  onSaved: () => void
}) {
  const [w, setW] = useState<WeeklyDraft | null>(pair.weekly)
  const [finalText, setFinalText] = useState(w?.admin_final_text ?? w?.caregiver_text ?? '')
  const [note, setNote] = useState(w?.admin_note ?? '')
  const [followup, setFollowup] = useState(w?.admin_followup ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const dayList = Object.values(pair.byDay).flat().sort((a, b) => a.report_date.localeCompare(b.report_date))
  const confirmed = w?.status === 'confirmed'
  const canReview = w && w.status !== 'draft'

  async function save(confirm: boolean) {
    if (!w) return
    setAsking(false)
    setBusy(true); setMessage(null)
    try {
      const r = await repo.review({ id: w.id, adminFinalText: confirmed ? undefined : finalText, adminNote: note, adminFollowup: followup, confirm, expectedUpdatedAt: w.updated_at })
      setW(r.weekly)
      setMessage(confirm ? '확정했습니다.' : '저장했습니다.')
      onSaved()
    } catch (e) {
      setMessage(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const col = 'rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-2 min-w-0'
  return (
    <section className="rounded-3xl bg-slate-100 p-4 flex flex-col gap-4" aria-label="주간 기록 검토">
      <h2 className="font-bold text-slate-900">요양보호사 {pair.caregiver} · {pair.recipient} 어르신</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className={col}>
          <h3 className="font-bold text-slate-800">① 원자료 전사본 <span className="font-normal text-xs text-slate-500">{dayList.length}일</span></h3>
          {dayList.length === 0 && <p className="text-sm text-slate-500">이 주의 하루 기록이 없습니다.</p>}
          {dayList.map((d) => (
            <div key={d.id} className="border-t border-slate-100 pt-2">
              <p className="text-xs font-bold text-slate-500">{d.report_date}{d.completion_seconds !== null ? ` · 작성 ${d.completion_seconds}초` : ''}</p>
              <p className="whitespace-pre-wrap text-sm text-slate-800">{transcriptText({ rawInput: d.raw_input, turns: d.followup_answers })}</p>
            </div>
          ))}
        </div>
        <div className={col}>
          <h3 className="font-bold text-slate-800">② AI 초안 <span className="font-normal text-xs text-slate-500">{w ? (w.ai_model === 'rule' ? 'AI 없이 자동 정리' : w.ai_model) : ''}</span></h3>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{w?.ai_draft ?? '아직 주간 초안을 만들지 않았습니다.'}</p>
        </div>
        <div className={col}>
          <h3 className="font-bold text-slate-800">③ 요양보호사 수정본 <span className="font-normal text-xs text-slate-500">
            {w?.caregiver_text ? `${w.caregiver_text === w.ai_draft ? '초안 그대로' : '수정함'}${w.caregiver_edit_seconds !== null ? ` · ${w.caregiver_edit_seconds}초` : ''}` : ''}</span></h3>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{w?.caregiver_text ?? (w ? '요양보호사가 아직 보내지 않았습니다.' : '-')}</p>
        </div>
      </div>

      {canReview ? (
        <div className="rounded-2xl bg-white border border-[#c9d4e8] p-4 flex flex-col gap-3">
          <label className="block">
            <span className="block font-bold text-slate-800 mb-1">④ 관리자 확정본 {confirmed && <span className="text-xs text-brand">· 확정됨 {w.admin_confirmed_at ? new Date(w.admin_confirmed_at).toLocaleString('ko-KR') : ''}</span>}</span>
            <textarea value={finalText} onChange={(e) => setFinalText(e.target.value)} readOnly={confirmed} rows={8}
              className={`w-full rounded-xl border border-slate-300 p-3 text-sm leading-relaxed ${confirmed ? 'bg-slate-50' : ''}`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block font-bold text-slate-800 mb-1">상담 기록</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="요양보호사·보호자와 나눈 상담 내용"
                className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
            </label>
            <label className="block">
              <span className="block font-bold text-slate-800 mb-1">후속조치 기록</span>
              <textarea value={followup} onChange={(e) => setFollowup(e.target.value)} rows={4} placeholder="다음 방문 확인 사항, 연계, 일정 등"
                className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
            </label>
          </div>
          {message && <p role="status" className="text-sm font-bold text-slate-700">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void save(false)} disabled={busy} className="rounded-full border border-slate-300 bg-white px-5 py-2 font-bold disabled:opacity-50">저장</button>
            {!confirmed && !asking && <button onClick={() => setAsking(true)} disabled={busy || !finalText.trim()} className="rounded-full bg-brand text-white px-5 py-2 font-bold disabled:opacity-50">확정</button>}
          </div>
          {!confirmed && asking && (
            <div role="alertdialog" aria-label="확정 확인" className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex flex-wrap items-center gap-2">
              <p className="text-sm text-amber-900 flex-1 min-w-[12rem]">확정하면 확정본은 더 고칠 수 없습니다(상담·후속조치는 계속 덧붙일 수 있습니다).</p>
              <button onClick={() => void save(true)} disabled={busy} className="rounded-full bg-brand text-white px-4 py-1.5 text-sm font-bold">확정하기</button>
              <button onClick={() => setAsking(false)} className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-bold">취소</button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-600">요양보호사가 주간 기록을 보내면 여기서 확인·수정·확정할 수 있습니다. 하루 기록은 위 ①에서 바로 볼 수 있습니다.</p>
      )}
    </section>
  )
}
