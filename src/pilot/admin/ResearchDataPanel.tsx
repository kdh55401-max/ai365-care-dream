/**
 * 관리자 "연구 자료" 화면: 사전·사후 기준일, 연구 동의·고수준 태그, 도입 전(사전) 기록 입력, 연구용 CSV 내보내기.
 * 동의한 요양보호사 기록만 내보낸다. 이름은 다루지 않고 코드만 쓴다.
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiClientError } from '../shared/api'
import { realResearchAdminRepo, type ResearchAdminRepo, type ResearchDataView } from '../shared/researchAdminRepo'
import { demoResearchAdminRepo } from '../demo/demoResearchAdminRepo'
import type { ResearchExportType, ResearchParticipant } from '../../../shared/researchExport'

function errorText(e: unknown): string {
  if (e instanceof ApiClientError && e.status === 401) return '관리자 로그인이 만료됐어요. 다시 로그인해 주세요.'
  return e instanceof Error && e.message ? e.message : '처리하지 못했어요. 다시 시도해 주세요.'
}

const box = 'rounded-2xl bg-white border border-slate-200 p-4 flex flex-col gap-3'
const input = 'rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white'

export function ResearchDataPanel({ demo }: { demo: boolean }) {
  const repo: ResearchAdminRepo = demo ? demoResearchAdminRepo : realResearchAdminRepo
  const [data, setData] = useState<ResearchDataView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [cutoff, setCutoffInput] = useState('')

  useEffect(() => {
    let active = true
    repo.data()
      .then((d) => { if (active) { setData(d); setCutoffInput(d.cutoffDate ?? ''); setError(null) } })
      .catch((e) => { if (active) setError(errorText(e)) })
    return () => { active = false }
  }, [repo, reload])

  async function run(action: () => Promise<void>, done: string) {
    setMessage(null); setError(null)
    try { await action(); setMessage(done); setReload((n) => n + 1) } catch (e) { setError(errorText(e)) }
  }

  const consentedCount = data?.participants.filter((p) => p.consented).length ?? 0
  const exports: Array<[ResearchExportType, string, string]> = [
    ['research_daily', '하루 기록(원자료 전사본)', '앱에서 남긴 하루 기록. 작성 시간·입력 방식·질문 생성 방식 포함'],
    ['research_weekly', '주간 상태변화기록', 'AI 초안 / 요양보호사 수정본 / 관리자 확정본 / 상담·후속조치를 열로 나눔'],
    ['research_pre', '도입 전(사전) 기록', '아래에서 옮겨 적은 종이·이지케어 상태변화기록'],
  ]

  return (
    <section className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-2xl bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-800">{message}</p>}

      <div className={box}>
        <h2 className="font-bold text-slate-900">사전·사후 기준일</h2>
        <p className="text-sm text-slate-600">
          기준일 <b>이전</b> 기록은 사전, 기준일 <b>당일부터</b>는 사후로 나눕니다. 내보낼 때마다 지금 기준일로 다시 계산하므로 나중에 바꿔도 됩니다.
          기준일이 비어 있으면 앱에서 남긴 기록은 사후, 아래에서 옮겨 적은 도입 전 기록은 사전으로 봅니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={cutoff} onChange={(e) => setCutoffInput(e.target.value)} className={input} aria-label="사전·사후 기준일" />
          <button onClick={() => void run(() => repo.setCutoff(cutoff || null), cutoff ? `기준일을 ${cutoff}로 저장했습니다.` : '기준일을 비웠습니다.')}
            className="rounded-full bg-teal-700 text-white px-4 py-2 text-sm font-bold">저장</button>
          <span className="text-sm text-slate-500">현재: {data?.cutoffDate ?? '미설정'}</span>
        </div>
      </div>

      <div className={box}>
        <h2 className="font-bold text-slate-900">연구 참여 요양보호사 <span className="text-sm font-normal text-slate-500">동의 {consentedCount}명</span></h2>
        <p className="text-sm text-slate-600">연구 참여에 동의한 요양보호사의 기록만 내보내기에 들어갑니다. 동의 철회 시 체크를 풀면 이후 내보내기에서 빠집니다. "기록 수준 높음"은 분석에서 따로 구분할 때 씁니다.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-xs text-slate-500 text-left"><th className="p-2">요양보호사</th><th className="p-2">연구 동의</th><th className="p-2">동의일</th><th className="p-2">기록 수준 높음</th><th className="p-2">메모</th><th className="p-2" /></tr></thead>
            <tbody>
              {data?.participants.map((p) => <ParticipantRow key={p.caregiver_code} p={p} onSave={(v) => run(() => repo.saveParticipant(v), `${p.caregiver_code} 연구 참여 정보를 저장했습니다.`)} />)}
            </tbody>
          </table>
        </div>
      </div>

      <PreRecordForm repo={repo} onDone={(msg) => { setMessage(msg); setError(null); setReload((n) => n + 1) }} onError={setError}
        caregivers={data?.participants.map((p) => p.caregiver_code) ?? []} />

      <div className={box}>
        <h2 className="font-bold text-slate-900">도입 전(사전) 기록 <span className="text-sm font-normal text-slate-500">{data?.preRecords.length ?? 0}건</span></h2>
        {data && data.preRecords.length === 0 && <p className="text-sm text-slate-500">아직 옮겨 적은 기록이 없습니다.</p>}
        <ul className="flex flex-col gap-2">
          {data?.preRecords.slice(0, 50).map((r) => (
            <li key={r.id} className="border-t border-slate-100 pt-2 flex gap-3 items-start">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-500">{r.record_date} · {r.caregiver_code} · {r.recipient_code} 어르신 · {r.source === 'paper' ? '종이' : r.source === 'easycare' ? '이지케어' : '기타'}{r.writing_seconds !== null ? ` · ${r.writing_seconds}초` : ''}</p>
                <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{r.record_text}</p>
              </div>
              <button onClick={() => void run(() => repo.hidePreRecord(r.id), '기록을 목록에서 뺐습니다.')} className="shrink-0 text-xs text-slate-500 underline">빼기</button>
            </li>
          ))}
        </ul>
      </div>

      <div className={box}>
        <h2 className="font-bold text-slate-900">연구용 내보내기 (엑셀에서 열리는 CSV)</h2>
        <p className="text-sm text-slate-600">
          연구 동의한 요양보호사 {consentedCount}명의 기록만 들어갑니다. 이름 없이 코드(C01, A01)만 들어가며, 사전·사후 구분과 근거 열이 붙습니다.
          {consentedCount === 0 && ' 지금은 동의한 사람이 없어 제목 줄만 내려받아집니다.'}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {exports.map(([type, label, note]) => (
            <button key={type} onClick={() => void run(() => repo.exportCsv(type), `${label} 파일을 내려받았습니다.`)}
              className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-left hover:bg-teal-100">
              <span className="block font-bold text-teal-800">{label}</span>
              <span className="block text-xs text-slate-600 mt-1">{note}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function ParticipantRow({ p, onSave }: { p: ResearchParticipant; onSave: (v: { code: string; consented: boolean; consentDate: string | null; highBaseline: boolean; note: string }) => Promise<void> }) {
  const [consented, setConsented] = useState(p.consented)
  const [date, setDate] = useState(p.consent_date ?? '')
  const [high, setHigh] = useState(p.high_baseline)
  const [note, setNote] = useState(p.note ?? '')
  const changed = consented !== p.consented || (date || null) !== p.consent_date || high !== p.high_baseline || (note || null) !== (p.note || null)
  return (
    <tr className="border-t border-slate-100">
      <td className="p-2 font-bold">{p.caregiver_code}</td>
      <td className="p-2"><input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} aria-label={`${p.caregiver_code} 연구 동의`} className="h-5 w-5" /></td>
      <td className="p-2"><input type="date" value={date} disabled={!consented} onChange={(e) => setDate(e.target.value)} aria-label={`${p.caregiver_code} 동의일`} className={input} /></td>
      <td className="p-2"><input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} aria-label={`${p.caregiver_code} 기록 수준 높음`} className="h-5 w-5" /></td>
      <td className="p-2"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label={`${p.caregiver_code} 메모`} className={`${input} w-full`} /></td>
      <td className="p-2"><button disabled={!changed} onClick={() => void onSave({ code: p.caregiver_code, consented, consentDate: consented ? date || null : null, highBaseline: high, note })}
        className="rounded-full bg-teal-700 text-white px-3 py-1 text-xs font-bold disabled:bg-slate-300">저장</button></td>
    </tr>
  )
}

function PreRecordForm({ repo, caregivers, onDone, onError }: { repo: ResearchAdminRepo; caregivers: string[]; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const d = Object.fromEntries(new FormData(form)) as Record<string, string>
    const minutes = d.minutes.trim() === '' ? null : Number(d.minutes)
    setBusy(true)
    try {
      await repo.addPreRecord({
        caregiverCode: d.caregiver, recipientCode: d.recipient.trim().toUpperCase(), recordDate: d.date, recordText: d.text,
        writingSeconds: minutes === null || !Number.isFinite(minutes) ? null : Math.round(minutes * 60),
        source: d.source === 'easycare' || d.source === 'other' ? d.source : 'paper',
      })
      form.reset()
      onDone('도입 전 기록을 추가했습니다.')
    } catch (e) { onError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className={box}>
      <h2 className="font-bold text-slate-900">도입 전(사전) 기록 옮겨 적기</h2>
      <p className="text-sm text-slate-600">도입 전 종이·이지케어 상태변화기록을 그대로 옮겨 적습니다. 어르신 이름 대신 코드(A01 등)를 쓰고, 본문의 이름·연락처도 지워 주세요. 작성 시간을 모르면 비워 둡니다.</p>
      <div className="grid gap-2 sm:grid-cols-5">
        <label className="text-xs text-slate-500">요양보호사
          <select name="caregiver" required className={`${input} w-full mt-1`}>{caregivers.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <label className="text-xs text-slate-500">어르신 코드
          <input name="recipient" required placeholder="A01" className={`${input} w-full mt-1`} />
        </label>
        <label className="text-xs text-slate-500">작성일
          <input name="date" type="date" required className={`${input} w-full mt-1`} />
        </label>
        <label className="text-xs text-slate-500">출처
          <select name="source" className={`${input} w-full mt-1`}><option value="paper">종이</option><option value="easycare">이지케어</option><option value="other">기타</option></select>
        </label>
        <label className="text-xs text-slate-500">작성 시간(분)
          <input name="minutes" type="number" min="0" step="0.5" placeholder="모르면 비움" className={`${input} w-full mt-1`} />
        </label>
      </div>
      <textarea name="text" required rows={4} placeholder="상태변화기록 본문" className={`${input} w-full`} aria-label="상태변화기록 본문" />
      <button disabled={busy} className="self-start rounded-full bg-teal-700 text-white px-5 py-2 text-sm font-bold disabled:opacity-50">{busy ? '저장 중…' : '추가'}</button>
    </form>
  )
}
