import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './http.js'
import { fetchAll, isMissingSchema, type RpcResult } from './workflowStore.js'
import type { CandidateReview } from '../../shared/changeCandidates.js'

/** 5단계(반복 보고·값 비교 후보에 대한 관리자 판단) 저장소. db/migrations/2026-09-18-change-candidate-reviews.sql 필요.
 * 후보 자체는 저장하지 않는다 — 보고·기준정보에서 같은 규칙으로 계산한다. */

let readyConfirmed = false

export async function candidateReviewsReady(supabase: SupabaseClient): Promise<boolean> {
  if (readyConfirmed) return true
  const { error } = await supabase.from('change_candidate_reviews').select('id', { head: true }).limit(1)
  if (error) {
    if (isMissingSchema(error)) return false
    throw new ApiError(500, '후보 판단 저장소 상태를 확인하지 못했습니다.')
  }
  readyConfirmed = true
  return true
}

export async function loadCandidateReviews(supabase: SupabaseClient, organizationId: string, recipientCode?: string): Promise<CandidateReview[]> {
  return fetchAll<CandidateReview>(() => {
    let q = supabase.from('change_candidate_reviews').select('*').eq('organization_id', organizationId)
    if (recipientCode) q = q.eq('recipient_code', recipientCode)
    return q.order('reviewed_at', { ascending: true }).order('id', { ascending: true })
  }, '후보 판단')
}

export async function loadReviewsForAction(supabase: SupabaseClient, organizationId: string, actionId: string): Promise<CandidateReview[]> {
  return fetchAll<CandidateReview>(
    () => supabase.from('change_candidate_reviews').select('*').eq('organization_id', organizationId).eq('linked_action_id', actionId).order('reviewed_at', { ascending: true }).order('id', { ascending: true }),
    '후보 판단',
  )
}

export async function callCandidateRpc(supabase: SupabaseClient, review: CandidateReview): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('candidate_review_append', { p: { review } })
  if (error) {
    if (isMissingSchema(error)) throw new ApiError(503, '후보 판단 저장소가 아직 준비되지 않았습니다(5단계 DB 마이그레이션 적용 필요).')
    console.error('candidate_review_append 실패:', error.message)
    throw new ApiError(500, '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return data as RpcResult
}
