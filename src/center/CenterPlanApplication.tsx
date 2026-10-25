import { useMemo, useRef, useState, useEffect } from 'react'
import type { PlanApplicationRow } from '../../shared/centerPlanApplication'
import type { StoredWeeklyPlan } from '../../shared/centerWeeklyPlanStore'
import { createDemoPlanApplicationRepository, serverPlanApplicationRepository } from './planApplicationRepo'
export function CenterPlanApplication({ plan, preview, onApplied }: { plan: StoredWeeklyPlan; preview: boolean; onApplied(): void }) {
  const repo = useMemo(() => preview ? createDemoPlanApplicationRepository(window.localStorage) : serverPlanApplicationRepository, [preview])
  const [rows, setRows] = useState<PlanApplicationRow[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const requestId = useRef<string | null>(null), lock = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  async function review() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice('')
    try { const result = await repo.review(plan); if (alive.current) { setRows(result); requestId.current = null } }
    catch (e) { if (alive.current) { setRows(null); setError(e instanceof Error ? e.message : '일정 조회 실패') } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function apply() {
    if (lock.current || !rows || rows.some(r => r.disposition === 'conflict')) return
    lock.current = true; setBusy(true); setError(''); requestId.current ??= crypto.randomUUID()
    try {
      const result = await repo.apply({ requestId: requestId.current, planId: plan.id, expectedVersion: plan.version })
      if (alive.current) { setRows(null); requestId.current = null; setNotice(`${preview ? '시연 ' : ''}방문일정 ${result.createdCount}건 생성 · 기존 반영/동일 일정 ${result.skippedCount}건 유지. 실제 제공·공단 확정이 아닙니다.`); onApplied() }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '반영 결과 미확인 · 같은 요청으로 재시도하세요.') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const label = { create: '신규 예정', linked: '이전 반영 유지', exact: '동일 일정 유지', conflict: '시간 겹침 · 반영 불가' }
  return <section aria-label="월 방문일정 반영"><h4>주간 계획을 월 방문일정으로 반영</h4><p>기존 일정은 덮어쓰지 않습니다. 이전 반영 항목을 수정·보관한 경우에도 다시 만들지 않습니다. 계획 수정 후 기존 일정 변경은 일정관리에서 별도로 처리하세요.</p><button disabled={busy} onClick={() => void review()}>월 일정 반영 내역 확인</button>
    {error && <p className="cd-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {rows && <><p>신규 {rows.filter(r => r.disposition === 'create').length}건 · 유지 {rows.filter(r => ['linked', 'exact'].includes(r.disposition)).length}건 · 겹침 {rows.filter(r => r.disposition === 'conflict').length}건</p><p>조회 이후 바뀐 일정은 저장 시 다시 검사합니다. 충돌이 있으면 전체를 반영하지 않습니다.</p><div className="cd-table-wrap"><table><thead><tr><th>날짜</th><th>시간</th><th>서비스</th><th>처리</th></tr></thead><tbody>{rows.slice(0, 100).map(r => <tr key={`${r.sourceEntryId}:${r.date}`}><td>{r.date}</td><td>{r.time}–{r.endTime}{r.endDate !== r.date ? ' (익일)' : ''}</td><td>{r.service}</td><td>{label[r.disposition]}</td></tr>)}</tbody></table></div>{rows.length > 100 && <p>총 {rows.length}건 중 처음 100건 표시</p>}<button disabled={busy || !rows.length || rows.some(r => r.disposition === 'conflict')} onClick={() => void apply()}>확인한 계획을 방문일정에 반영</button><button disabled={busy} onClick={() => { setRows(null); setError('') }}>닫기</button></>}{busy && <p role="status">월 일정 확인·반영 중…</p>}
  </section>
}
