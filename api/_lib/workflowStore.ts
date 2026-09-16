import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import type { ActionEvent, ActionObligation, AdminDecision, CareAction, ReportEvent, SafetyReview } from '../../shared/workflow.js'

/** 관리자 업무(2단계) 저장소 접근. 업무 규칙은 shared/workflow.ts, 원자적 쓰기는
 * db/migrations/2026-09-15-admin-workflow.sql 의 함수가 맡는다. */

const PAGE = 1000 // Supabase(PostgREST)는 한 번에 최대 1000행만 준다 — 전체 범위 집계를 위해 끝까지 넘겨 읽는다.

interface PgError {
  code?: string
  message?: string
}

/** 마이그레이션이 아직 적용되지 않아 테이블·함수가 없을 때 나는 오류인지. */
export function isMissingSchema(error: PgError | null | undefined): boolean {
  if (!error) return false
  if (error.code && ['42P01', 'PGRST205', 'PGRST202', '42883'].includes(error.code)) return true
  const m = error.message ?? ''
  return /does not exist|schema cache|Could not find the (table|function)/i.test(m)
}

type PageQuery = { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PgError | null }> }

/** 조건을 붙인 쿼리를 1000행씩 끝까지 읽는다. 쪽을 넘길 때 행이 빠지거나 겹치지 않도록
 * 호출부는 유일한 열(id)까지 포함한 정렬을 붙인다. */
export async function fetchAll<T>(makeQuery: () => PageQuery, what: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new ApiError(500, `${what}을(를) 불러오지 못했습니다.`)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const WORKFLOW_TABLES = ['report_events', 'admin_decisions', 'safety_reviews', 'care_actions', 'action_obligations', 'action_events'] as const

/** 2단계 테이블이 모두 있는지. 하나라도 없으면 판단·조치·안전 검토 기능을 "준비 중"으로 둔다.
 * 없음이 아닌 다른 오류(네트워크 등)는 숨기지 않고 500으로 올린다 — 조회 실패를 "0건"으로 보이지 않게. */
// 한 번 준비됐으면 테이블이 사라지지 않으므로 같은 서버리스 인스턴스에서는 다시 묻지 않는다.
let readyConfirmed = false

export async function workflowReady(supabase: SupabaseClient): Promise<boolean> {
  if (readyConfirmed) return true
  const results = await Promise.all(WORKFLOW_TABLES.map((t) => supabase.from(t).select('id', { head: true }).limit(1)))
  for (const r of results) {
    if (r.error) {
      if (isMissingSchema(r.error)) return false
      throw new ApiError(500, '업무 기록 저장소 상태를 확인하지 못했습니다.')
    }
  }
  readyConfirmed = true
  return true
}

export interface WorkflowRows {
  decisions: AdminDecision[]
  safetyReviews: SafetyReview[]
  actions: CareAction[]
  obligations: ActionObligation[]
  reportEvents: ReportEvent[]
}

/** 기관 범위의 2단계 기록 전체. reportIds를 주면 그 보고들에 붙은 판단·안전 검토·이벤트만,
 * recipientCode를 주면 그 수급자의 조치만 읽는다. */
export async function loadWorkflowRows(
  supabase: SupabaseClient,
  organizationId: string,
  scope: { reportIds?: string[]; recipientCode?: string } = {},
): Promise<WorkflowRows> {
  const perReports = async <T>(table: string, orderBy: string, byOrg: boolean): Promise<T[]> => {
    const build = (ids?: string[]) => () => {
      let q = supabase.from(table).select('*')
      if (byOrg) q = q.eq('organization_id', organizationId)
      if (ids) q = q.in('report_id', ids)
      return q.order(orderBy, { ascending: true }).order('id', { ascending: true })
    }
    if (!scope.reportIds) return fetchAll<T>(build(), table)
    return (await Promise.all(chunk(scope.reportIds, 200).map((ids) => fetchAll<T>(build(ids), table)))).flat()
  }
  const [decisions, safetyReviews, reportEvents, actions] = await Promise.all([
    perReports<AdminDecision>('admin_decisions', 'decided_at', true),
    perReports<SafetyReview>('safety_reviews', 'reviewed_at', true),
    // 보고 이벤트는 보고에 딸린 기록이라 기관 컬럼이 없다(이 배포 = 기관 한 곳).
    perReports<ReportEvent>('report_events', 'occurred_at', false),
    fetchAll<CareAction>(() => {
      let q = supabase.from('care_actions').select('*').eq('organization_id', organizationId)
      if (scope.recipientCode) q = q.eq('recipient_code', scope.recipientCode)
      return q.order('created_at', { ascending: true }).order('id', { ascending: true })
    }, '조치'),
  ])
  const obligations = (
    await Promise.all(
      chunk(actions.map((a) => a.id), 200).map((ids) =>
        fetchAll<ActionObligation>(() => supabase.from('action_obligations').select('*').in('action_id', ids).order('created_at', { ascending: true }).order('id', { ascending: true }), '조치 기한'),
      ),
    )
  ).flat()
  return { decisions, safetyReviews, actions, obligations, reportEvents }
}
/** 6단계 운영 지표(재개방 건수 등)용 — 이 기관 조치들에 달린 이력 전체.
 * action_events에는 기관 컬럼이 없어(이 배포 = 기관 한 곳) 조치 id로 범위를 좁힌다. */
export async function loadActionEvents(supabase: SupabaseClient, actionIds: string[]): Promise<ActionEvent[]> {
  if (!actionIds.length) return []
  const pages = await Promise.all(
    chunk(actionIds, 200).map((ids) =>
      fetchAll<ActionEvent>(
        () => supabase.from('action_events').select('*').in('action_id', ids).order('occurred_at', { ascending: true }).order('id', { ascending: true }),
        '조치 이력',
      ),
    ),
  )
  return pages.flat()
}

export async function loadActionState(supabase: SupabaseClient, organizationId: string, actionId: string) {
  const { data: action, error } = await supabase.from('care_actions').select('*').eq('id', actionId).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new ApiError(500, '조치를 불러오지 못했습니다.')
  if (!action) throw new ApiError(404, '이 기관에서 해당 조치를 찾을 수 없습니다.')
  const [obligations, events] = await Promise.all([
    fetchAll<ActionObligation>(() => supabase.from('action_obligations').select('*').eq('action_id', actionId).order('created_at', { ascending: true }).order('id', { ascending: true }), '조치 기한'),
    fetchAll<ActionEvent>(() => supabase.from('action_events').select('*').eq('action_id', actionId).order('occurred_at', { ascending: true }).order('id', { ascending: true }), '조치 이력'),
  ])
  return { action: action as CareAction, obligations, events }
}

export interface RpcResult {
  status: 'ok' | 'duplicate' | 'conflict' | 'not_found' | 'invalid'
  message?: string
  row?: unknown
  action_id?: string
  version?: number
}

export async function callWorkflowRpc(supabase: SupabaseClient, fn: string, payload: unknown): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(fn, { p: payload })
  if (error) {
    if (isMissingSchema(error)) throw new ApiError(503, '업무 기록 저장소가 아직 준비되지 않았습니다(DB 마이그레이션 적용 필요).')
    console.error(`${fn} 실패:`, error.message)
    throw new ApiError(500, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return data as RpcResult
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
