import { findResponseEvidence, type CenterRequestView } from '../../../shared/fieldRequests'
import type { FieldResponseInput, ResponseStatus } from '../../../shared/workflow'

/** 센터 확인 요청 답(보고 확인 화면)의 입력 상태와 서버 전송 형태 — CenterRequests.tsx 화면이 쓴다. */

export interface CenterAnswerDraft {
  status: ResponseStatus | null
  text: string
  /** 보고 원문에서 찾은 문장을 답의 근거로 쓰기로 확인했는지. */
  useEvidence: boolean
  /** 재시도해도 같은 답이 두 번 저장되지 않게 하는 요청 식별자(요청마다 하나). */
  requestId: string
}

const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export function emptyAnswer(): CenterAnswerDraft {
  return { status: null, text: '', useEvidence: false, requestId: newRequestId() }
}

/** 고른 답만 서버로 보낼 형태로 바꾼다("이번에는 답하지 않음"은 보내지 않는다). */
export function toResponseInputs(requests: CenterRequestView[], answers: Record<string, CenterAnswerDraft>, texts: string[]): FieldResponseInput[] {
  const out: FieldResponseInput[] = []
  for (const r of requests) {
    const a = answers[r.id]
    if (!a || a.status === null) continue
    const evidence = a.useEvidence ? findResponseEvidence(r.message, texts) : null
    out.push({ fieldRequestId: r.id, status: a.status, text: a.text.trim() || null, evidenceExcerpt: evidence, requestId: a.requestId })
  }
  return out
}

/** 답하려면 채워야 하는 것이 빠졌는지("기타"는 내용 필요). */
export function missingAnswerDetail(requests: CenterRequestView[], answers: Record<string, CenterAnswerDraft>): boolean {
  return requests.some((r) => {
    const a = answers[r.id]
    return a?.status === 'other' && !a.useEvidence && !a.text.trim()
  })
}
