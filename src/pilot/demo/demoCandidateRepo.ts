import { WorkflowRequestError } from '../shared/adminRepo'
import { compareScaleValues, computeRepeatCandidates, planCandidateReview, type CandidateReview, type CandidateReviewInput, type ReviewableCandidate } from '../../../shared/changeCandidates'
import { buildRecipientObservations, type RecipientObservationsView } from '../../../shared/observationViews'
import { WorkflowError, type WorkflowContext } from '../../../shared/workflow'
import { DEPLOYMENT_ORGANIZATION } from '../../../shared/organization'
import { DEMO_RECIPIENT_CODES, demoAllReports, demoReadWorkflow, demoWriteWorkflow, newDemoId } from './demoStore'
import { demoBaselineReady } from './demoBaselineRepo'
import { demoWorkflowReady } from './demoWorkflowRepo'

/** 데모 모드의 5단계(관찰 달력·반복 보고 후보·값 비교·후보 판단). 실서버와 같은 규칙(shared/changeCandidates.ts)을 쓴다.
 * 데모 전용 스위치: `?demo_workflow=stage4` = 5단계 DB 미적용(후보 판단 저장소 없음 — 달력·후보 계산은 그대로). */

function flag(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('demo_workflow')
  } catch {
    return null
  }
}

export function demoCandidateReviewsReady(): boolean {
  return demoWorkflowReady() && !['stage2', 'stage3', 'stage4'].includes(flag() ?? '')
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
}

function ctx(): WorkflowContext {
  return { now: new Date().toISOString(), organizationId: DEPLOYMENT_ORGANIZATION.id, newId: newDemoId }
}

function reviews(): CandidateReview[] {
  return demoReadWorkflow().candidateReviews ?? []
}

export function demoGetRecipientObservations(code: string, window: 7 | 30): RecipientObservationsView {
  const c = code.trim().toUpperCase()
  if (!DEMO_RECIPIENT_CODES.includes(c)) throw new WorkflowRequestError(404, '이 기관에서 해당 수급자를 찾을 수 없습니다.')
  const wf = demoReadWorkflow()
  return buildRecipientObservations({
    recipientCode: c,
    reports: demoAllReports(),
    window,
    today: todayKst(),
    now: new Date(),
    reviews: demoCandidateReviewsReady() ? reviews() : [],
    reviewsReady: demoCandidateReviewsReady(),
    baselineEntries: demoBaselineReady() ? (wf.baseline?.entries ?? []) : null,
    actions: demoWorkflowReady() ? wf.actions : [],
  })
}

export function demoReviewCandidate(input: CandidateReviewInput & { recipientCode: string; window: 7 | 30 }): RecipientObservationsView {
  if (!demoCandidateReviewsReady()) throw new WorkflowRequestError(503, '후보 판단 저장소가 아직 준비되지 않았습니다(5단계 DB 마이그레이션 적용 필요).')
  const code = input.recipientCode.trim().toUpperCase()
  if (!reviews().some((r) => r.request_id === input.requestId)) {
    const candidates: ReviewableCandidate[] = computeRepeatCandidates(demoAllReports(), todayKst()).candidates.filter((c) => c.recipientCode === code)
    if (demoBaselineReady()) candidates.push(...compareScaleValues((demoReadWorkflow().baseline?.entries ?? []).filter((e) => e.recipient_code === code)).comparisons)
    const candidate = candidates.find((c) => c.key === input.candidateKey)
    if (!candidate) throw new WorkflowRequestError(409, '이 후보는 지금 조건을 채우지 않거나 근거가 바뀌었습니다. 화면을 새로 불러와 주세요.')
    const linked = input.linkedActionId ? (demoReadWorkflow().actions.find((a) => a.id === input.linkedActionId) ?? null) : null
    try {
      const review = planCandidateReview(candidate, input, linked, ctx())
      demoWriteWorkflow((w) => {
        w.candidateReviews = [...(w.candidateReviews ?? []), review]
      })
    } catch (e) {
      if (e instanceof WorkflowError) throw new WorkflowRequestError(e.status, e.message)
      throw e
    }
  }
  return demoGetRecipientObservations(code, input.window)
}
