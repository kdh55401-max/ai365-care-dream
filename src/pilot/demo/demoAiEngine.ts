import type { AiTurnResult, FollowupItem, StructuredReport } from '../../../shared/careTypes.js'

/** Gemini 키가 없을 때(또는 데모 모드에서) 쓰는 규칙 기반 질문·구조화 엔진.
 * 실제 AI 결과가 아니므로 화면에서는 반드시 "데모 데이터"로 표시해야 한다.
 * 사용자가 말한 내용만 그대로 반영하고, 빠진 정보는 "확인되지 않음"으로 남긴다. */

const TIME_HINTS = ['오전', '오후', '아침', '점심', '저녁', '새벽', '방금', '시', '분']
const ACTION_HINTS = ['부축', '연락', '전화', '조치', '119', '앉혔', '눕혔', '확인함', '병원', '휴식', '마사지']
const RESULT_HINTS = ['현재', '지금', '계속', '호전', '진정', '쉬고', '괜찮아', '그대로', '유지', '지속']

function has(text: string, hints: string[]): boolean {
  return hints.some((h) => text.includes(h))
}

export function runDemoAiTurn(rawInput: string, history: FollowupItem[]): AiTurnResult {
  const combined = [rawInput, ...history.map((h) => h.answer)].join(' ')

  if (!has(combined, TIME_HINTS) && history.length < 3) {
    return {
      needFollowup: true,
      question: '언제, 어떤 상황에서 있었던 일인가요?',
      missingField: 'change_time',
      report: null,
    }
  }
  if (!has(combined, ACTION_HINTS) && history.length < 3) {
    return {
      needFollowup: true,
      question: '그때 현장에서 어떤 조치를 하셨나요? (예: 부축, 센터 연락 등)',
      missingField: 'action_taken',
      report: null,
    }
  }
  if (!has(combined, RESULT_HINTS) && history.length < 3) {
    return {
      needFollowup: true,
      question: '지금 상태는 어떤가요? 좋아지셨나요, 계속되고 있나요?',
      missingField: 'current_result',
      report: null,
    }
  }

  const report: StructuredReport = {
    change: rawInput || '확인되지 않음',
    action: findAnswerFor(history, 'action_taken') ?? (has(combined, ACTION_HINTS) ? extractSentenceWith(combined, ACTION_HINTS) : '확인되지 않음'),
    result: findAnswerFor(history, 'current_result') ?? (has(combined, RESULT_HINTS) ? extractSentenceWith(combined, RESULT_HINTS) : '확인되지 않음'),
    escalation: '센터가 관찰 내용을 확인하고 다음 방문 시 추가 관찰이 필요한지 판단 필요.',
  }
  return { needFollowup: false, question: null, missingField: null, report }
}

function findAnswerFor(history: FollowupItem[], field: string): string | undefined {
  return history.find((h) => h.missingField === field)?.answer
}

function extractSentenceWith(text: string, hints: string[]): string {
  const sentences = text.split(/[.!?]|(?<=요)\s/)
  const hit = sentences.find((s) => hints.some((h) => s.includes(h)))
  return (hit ?? text).trim() || '확인되지 않음'
}
