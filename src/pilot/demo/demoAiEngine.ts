import type { AiTurnResult, FollowupItem, StructuredReport } from '../../../shared/careTypes.js'
import { extractCaregiverNote } from '../../../shared/caregiverNote.js'
import { isLikelyOffTopic } from '../../../shared/offTopicEngine.js'

/** Gemini 키가 없을 때(또는 데모 모드에서) 쓰는 규칙 기반 질문·구조화 엔진.
 * 실제 AI 결과가 아니므로 화면에서는 반드시 "데모 데이터"로 표시해야 한다.
 * 사용자가 말한 내용만 그대로 반영하고, 빠진 정보는 "확인되지 않음"으로 남긴다. */

const TIME_HINTS = ['오전', '오후', '아침', '점심', '저녁', '새벽', '방금', '시', '분']
const ACTION_HINTS = ['부축', '연락', '전화', '조치', '119', '앉혔', '눕혔', '확인함', '병원', '휴식', '마사지']
const RESULT_HINTS = ['현재', '지금', '계속', '호전', '진정', '쉬고', '괜찮아', '그대로', '유지', '지속']

function has(text: string, hints: string[]): boolean {
  return hints.some((h) => text.includes(h))
}

const OFF_TOPIC_REDIRECT_QUESTION = '오늘 어르신 돌봄 이야기로 다시 여쭤볼게요. 오늘 어르신은 어떠셨어요?'

export function runDemoAiTurn(rawInput: string, history: FollowupItem[], forceFinalize = false): AiTurnResult {
  // 첫 발화가 돌봄과 무관한 잡담이면(날씨/뉴스 등) 그 내용을 보고문에 담지 않고
  // 짧게 한 번만 돌봄 이야기로 되돌린다. 되돌린 뒤에도 다시 무관한 답이 오면(예:
  // 계속 딴 이야기) 더 반복해서 묻지 않고 "확인되지 않음"으로 정리해 센터가 원문을
  // 보게 한다 — 무관한 발언을 어르신 상태로 둔갑시키지 않는다.
  const lastWasOffTopicRedirect = history.length > 0 && history[history.length - 1].missingField === 'offtopic_redirect'
  if (history.length === 0 && isLikelyOffTopic(rawInput)) {
    return {
      needFollowup: true,
      question: OFF_TOPIC_REDIRECT_QUESTION,
      missingField: 'offtopic_redirect',
      report: null,
    }
  }
  if (lastWasOffTopicRedirect && isLikelyOffTopic(history[history.length - 1].answer)) {
    return {
      needFollowup: false,
      question: null,
      missingField: null,
      report: {
        change: '요양보호사가 돌봄과 관련된 구체적인 내용을 말씀하지 않았습니다. 센터가 직접 확인이 필요합니다.',
        action: '확인되지 않음',
        result: '확인되지 않음',
        escalation: '요양보호사가 돌봄 관련 내용을 말씀하지 않아 센터 확인이 필요합니다.',
        caregiverNote: '',
      },
    }
  }

  const combined = [rawInput, ...history.map((h) => h.answer)].join(' ')
  const askMore = !forceFinalize && history.length < 3
  // 이미 그 항목을 질문해서 답을 받았으면(버튼 답이 힌트 키워드를 그대로 포함하지
  // 않아도) 같은 질문을 다시 하지 않는다 — "이미 답변된 내용은 다시 묻지 않는다"는
  // 원칙은 원문에 힌트 단어가 있는지가 아니라 실제로 물어봤는지로 판단해야 한다.
  const wasAsked = (field: string) => history.some((h) => h.missingField === field)

  if (!wasAsked('change_time') && !has(combined, TIME_HINTS) && askMore) {
    return {
      needFollowup: true,
      question: '언제, 어떤 상황에서 있었던 일인가요?',
      missingField: 'change_time',
      report: null,
      options: ['방문 초반에', '방문 중간에', '방문 마무리에'],
      allowMultiple: false,
    }
  }
  if (!wasAsked('action_taken') && !has(combined, ACTION_HINTS) && askMore) {
    return {
      needFollowup: true,
      question: '그때 현장에서 어떤 조치를 하셨나요?',
      missingField: 'action_taken',
      report: null,
      options: ['말씀드리고 권해드렸어요', '도와드렸어요', '센터에 연락했어요', '아직 못 했어요'],
      allowMultiple: true,
    }
  }
  if (!wasAsked('current_result') && !has(combined, RESULT_HINTS) && askMore) {
    return {
      needFollowup: true,
      question: '지금 상태는 어떤가요?',
      missingField: 'current_result',
      report: null,
      options: ['좋아지셨어요', '그대로예요', '계속되고 있어요'],
      allowMultiple: false,
    }
  }

  // change(관찰한 돌봄 상황)의 기준 발화는 보통 최초 입력(rawInput)이다. 다만
  // 최초 입력이 돌봄과 무관해 되물었던 경우(offtopic_redirect)에는, 실제 관찰
  // 내용은 rawInput이 아니라 그 되물음에 대한 답변이므로 그것을 기준으로 삼는다
  // — 그러지 않으면 무관한 잡담이 어르신의 상태로 그대로 저장된다.
  const offTopicRedirectAnswer = history.find((h) => h.missingField === 'offtopic_redirect')?.answer
  const baseObservation = offTopicRedirectAnswer ?? rawInput

  const report: StructuredReport = {
    change: baseObservation || '확인되지 않음',
    action: findAnswerFor(history, 'action_taken') ?? (has(combined, ACTION_HINTS) ? extractSentenceWith(combined, ACTION_HINTS) : '확인되지 않음'),
    result: findAnswerFor(history, 'current_result') ?? (has(combined, RESULT_HINTS) ? extractSentenceWith(combined, RESULT_HINTS) : '확인되지 않음'),
    escalation: '센터가 관찰 내용을 확인하고 다음 방문 시 추가 관찰이 필요한지 판단 필요.',
    // 요양보호사 본인의 어려움·지원요청은 change(어르신 관찰)와 분리해 뽑는다.
    caregiverNote: extractCaregiverNote(combined),
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
