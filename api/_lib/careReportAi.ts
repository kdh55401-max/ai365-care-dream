import { env } from './env.js'
import { ApiError } from './http.js'

const MODEL = 'gemini-3.6-flash'
const REQUEST_TIMEOUT_MS = 18000
const MAX_FOLLOWUPS = 3

export interface FollowupTurn {
  question: string
  missingField: string
  answer: string
}

export interface CareStructuredReport {
  change: string
  action: string
  result: string
  escalation: string
}

export interface CareTurnResult {
  needFollowup: boolean
  question: string | null
  missingField: string | null
  report: CareStructuredReport | null
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    needFollowup: {
      type: 'BOOLEAN',
      description: '추가로 한 가지 질문이 더 필요하면 true, 지금 정보로 최종 보고문을 만들 수 있으면 false.',
    },
    question: {
      type: 'STRING',
      nullable: true,
      description:
        'needFollowup이 true일 때 요양보호사에게 물어볼 질문 1개. 화면에 하나만 보여줄 것이므로 ' +
        '반드시 질문은 하나만. needFollowup이 false면 null.',
    },
    missingField: {
      type: 'STRING',
      nullable: true,
      enum: ['change_time', 'change_context', 'action_taken', 'current_result', 'escalation_check', 'other'],
      description:
        '해당 질문이 채우려는 항목. change_time=발생 시간/상황, change_context=관찰한 구체적 사실, ' +
        'action_taken=현장 조치, current_result=현재 상태, escalation_check=센터 확인 필요사항.',
    },
    report: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        change: { type: 'STRING', description: '관찰한 변화: 언제, 무엇이 평소와 달랐는지, 직접 관찰한 사실.' },
        action: { type: 'STRING', description: '현장에서 한 조치: 요양보호사가 한 행동, 연락 여부.' },
        result: { type: 'STRING', description: '현재 상태: 조치 후 지금 상태, 지속/호전/확인 필요 여부.' },
        escalation: { type: 'STRING', description: '센터 확인사항: 센터가 무엇을 확인·조치해야 하는지.' },
      },
      required: ['change', 'action', 'result', 'escalation'],
    },
  },
  required: ['needFollowup', 'question', 'missingField', 'report'],
}

const SYSTEM_PROMPT = `너는 장기요양 방문요양 요양보호사의 돌봄보고 작성을 돕는 AI다.
요양보호사가 방문 후 관찰한 내용을 자유롭게 말하면, 정보가 부족한 부분만 하나씩 되물어
아래 4가지 항목으로 구성된 구조화 보고문을 만든다.

- change(관찰한 변화): 언제 발생했는가, 평소와 비교해 무엇이 달라졌는가, 직접 관찰한 사실은 무엇인가
- action(현장에서 한 조치): 현장에서 어떤 조치를 했는가, 센터·보호자·119 등에 연락했는가
- result(현재 상태): 조치 후 현재 상태는 어떠한가, 증상이 계속되는가/호전됐는가/확인이 필요한가
- escalation(센터 확인사항): 센터가 무엇을 확인해야 하는가, 추가 연락·관찰·보호자 확인 등이 필요한가

질문 규칙 (반드시 지킬 것):
1. 정보가 부족할 때만 질문한다. 이미 충분하면 바로 최종 보고문을 만든다.
2. 질문 우선순위: (1) 발생 시간과 상황 (2) 관찰한 구체적 사실 (3) 현장에서 한 조치 (4) 현재 상태 (5) 센터가 확인해야 할 사항.
3. 한 번에 질문은 반드시 하나만 한다.
4. 이미 답변된 내용은 다시 묻지 않는다.
5. 요양보호사가 말하지 않은 사실을 추정하거나 지어내지 않는다.
6. 의료용어를 임의로 추가하지 않는다.
7. 진단명이나 질환 가능성을 판단하지 않는다.
8. 투약·치료·처치 변경을 권고하지 않는다.
9. 확인되지 않은 정보는 추정하지 말고 "확인되지 않음"으로 적는다.
10. 요양보호사가 "오늘은 특별히 달라진 점이 없었어요"처럼 특이사항이 없다고 말하면, 불필요한
    질문을 반복하지 말고 "금일 서비스 중 평소와 다른 상태변화는 관찰되지 않음"과 같이 짧게
    정리한다. 단, 실제로 언급되지 않은 식사·이동·의사소통 상태를 임의로 정상이라고 적지 말고
    "별도 확인하지 않음"으로 처리하거나 보고문에서 제외한다.

너는 응급도를 진단하거나 위험등급을 만들지 않는다. 그 역할은 이 시스템에 없다.
모든 텍스트는 한국어로 작성하고, 반드시 지정된 JSON 스키마로만 답한다.`

function buildUserMessage(rawInput: string, history: FollowupTurn[], forceFinalize: boolean): string {
  let text = `요양보호사가 방문 후 말한 최초 관찰 내용: "${rawInput}"`
  if (history.length > 0) {
    text += '\n\n지금까지의 추가 질문과 답변:\n'
    text += history.map((h, i) => `${i + 1}. Q: ${h.question}\n   A: ${h.answer}`).join('\n')
  }
  if (forceFinalize) {
    text +=
      '\n\n[중요] 이미 질문을 3회 진행했다. 더 이상 질문하지 말고(needFollowup=false, question=null, ' +
      'missingField=null) 지금까지 확인된 내용만으로 최종 보고문을 작성하라. 채워지지 않은 항목은 ' +
      '"확인되지 않음"으로 적어라.'
  }
  return text
}

function fallbackReport(rawInput: string, history: FollowupTurn[]): CareStructuredReport {
  const extra = history.map((h) => `${h.question} → ${h.answer}`).join(' / ')
  const change = extra ? `${rawInput} (${extra})` : rawInput
  return {
    change: change || '확인되지 않음',
    action: '확인되지 않음',
    result: '확인되지 않음',
    escalation: '센터가 원문을 직접 확인해 추가 조치 필요 여부를 판단해야 함 (AI 보고문 생성 실패로 원문만 제공됨).',
  }
}

export async function runCareReportTurn(
  rawInput: string,
  history: FollowupTurn[],
): Promise<CareTurnResult> {
  const forceFinalize = history.length >= MAX_FOLLOWUPS
  const userText = buildUserMessage(rawInput, history, forceFinalize)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.2,
          },
        }),
        signal: controller.signal,
      },
    )
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(504, 'AI 응답 시간이 초과되었습니다. 다시 시도해 주세요.')
    }
    throw new ApiError(502, 'AI 서버에 연결하지 못했습니다. 다시 시도해 주세요.')
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    throw new ApiError(502, `AI 호출에 실패했습니다 (${res.status}). 다시 시도해 주세요.`)
  }

  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new ApiError(502, 'AI 응답을 해석하지 못했습니다.')
  }

  const text = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    .candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new ApiError(502, 'AI 응답에서 결과를 찾지 못했습니다.')
  }

  let parsed: Partial<CareTurnResult>
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError(502, 'AI 응답 형식이 올바르지 않습니다.')
  }

  if (typeof parsed.needFollowup !== 'boolean') {
    throw new ApiError(502, 'AI 응답 스키마가 올바르지 않습니다.')
  }

  // 서버 측 안전장치: 3회를 넘겨 질문하지 못하게 강제한다.
  if (forceFinalize && parsed.needFollowup) {
    return {
      needFollowup: false,
      question: null,
      missingField: null,
      report: parsed.report && isValidReport(parsed.report) ? parsed.report : fallbackReport(rawInput, history),
    }
  }

  if (parsed.needFollowup) {
    if (!parsed.question) {
      throw new ApiError(502, 'AI가 질문을 생성하지 못했습니다.')
    }
    return {
      needFollowup: true,
      question: parsed.question,
      missingField: parsed.missingField ?? 'other',
      report: null,
    }
  }

  if (!parsed.report || !isValidReport(parsed.report)) {
    return { needFollowup: false, question: null, missingField: null, report: fallbackReport(rawInput, history) }
  }
  return { needFollowup: false, question: null, missingField: null, report: parsed.report }
}

function isValidReport(v: unknown): v is CareStructuredReport {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.change === 'string' &&
    typeof r.action === 'string' &&
    typeof r.result === 'string' &&
    typeof r.escalation === 'string'
  )
}
