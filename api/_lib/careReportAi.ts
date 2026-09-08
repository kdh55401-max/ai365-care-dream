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
  caregiverNote: string
}

export interface CareTurnResult {
  needFollowup: boolean
  question: string | null
  missingField: string | null
  report: CareStructuredReport | null
  options?: string[]
  allowMultiple?: boolean
  /** report가 채워진 턴에서만 의미 있음 — fallbackReport()로 대체됐으면 true. */
  usedFallback: boolean
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
    options: {
      type: 'ARRAY',
      nullable: true,
      items: { type: 'STRING' },
      description:
        'needFollowup이 true일 때, 요양보호사가 타이핑 대신 바로 누를 수 있는 짧은 선택지 2~4개. ' +
        '반드시 question에 대한 실제로 가능성 있는 답만 담고, 구체적 수치(예: "300ml")를 지어내지 말고 ' +
        '"조금 적게/많이 적게"처럼 요양보호사가 실제로 관찰했을 법한 정성적 표현으로 짧게 쓴다. ' +
        '적절한 선택지를 만들기 어려우면 빈 배열이나 null로 두어 자유 입력만 쓰게 한다. ' +
        '"잘 모르겠어요"는 화면이 항상 별도로 붙여주므로 옵션에 넣지 않는다.',
    },
    allowMultiple: {
      type: 'BOOLEAN',
      nullable: true,
      description: '해당 질문이 복수 선택이 자연스러우면 true(예: 오늘 한 조치가 여러 개일 수 있는 질문). 아니면 false.',
    },
    report: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        change: {
          type: 'STRING',
          description:
            '관찰한 돌봄 상황: 언제, 무엇을 직접 관찰했는지 사실만 적는다. 평소와 비교할 근거가 실제로 ' +
            '있을 때만 "평소와 달리"처럼 변화로 서술하고, 비교 근거가 없으면 변화 여부를 단정하지 말고 ' +
            '있는 그대로의 상황만 적는다.',
        },
        action: { type: 'STRING', description: '현장에서 한 조치: 요양보호사가 한 행동, 연락 여부.' },
        result: { type: 'STRING', description: '현재 상태: 조치 후 지금 상태, 지속/호전/확인 필요 여부.' },
        escalation: { type: 'STRING', description: '센터 확인사항: 센터가 무엇을 확인·조치해야 하는지.' },
        caregiverNote: {
          type: 'STRING',
          description:
            '요양보호사 본인이 표현한 어려움·지원요청(change와 분리). 어르신에 대한 관찰이 아니라 ' +
            '요양보호사 자신의 경험/부담/도움 요청일 때만 적는다. 없으면 빈 문자열.',
        },
      },
      required: ['change', 'action', 'result', 'escalation', 'caregiverNote'],
    },
  },
  required: ['needFollowup', 'question', 'missingField', 'report'],
}

const SYSTEM_PROMPT = `너는 장기요양 방문요양 요양보호사의 돌봄보고 작성을 돕는 AI다.
요양보호사가 방문 후 관찰한 내용을 자유롭게 말하면, 정보가 부족한 부분만 하나씩 되물어
아래 4가지 항목으로 구성된 구조화 보고문을 만든다.

- change(관찰한 돌봄 상황): 언제, 무엇을 직접 관찰했는가. 평소와 비교할 근거가 실제로 있을 때만
  "평소와 달리 ~"처럼 변화로 서술한다. 비교 근거가 없으면 변화 여부를 단정하지 말고 있는 그대로의
  상황만 적는다(예: "확인 안 됨"이 아니라 사실을 그대로 서술하되 "평소 대비 변화 여부는 미확인"처럼
  구분해 표현).
- action(현장에서 한 조치): 현장에서 어떤 조치를 했는가, 센터·보호자·119 등에 연락했는가
- result(현재 상태): 조치 후 현재 상태는 어떠한가, 증상이 계속되는가/호전됐는가/확인이 필요한가
- escalation(센터 확인사항): 센터가 무엇을 확인해야 하는가, 추가 연락·관찰·보호자 확인 등이 필요한가
- caregiverNote(요양보호사 상황·지원요청): 요양보호사 본인이 힘들다/지쳤다/도움이 필요하다고 표현한
  내용. change(어르신에 대한 관찰 사실)와 반드시 분리한다. "어르신이 거절하셔서 힘들었어요"처럼
  어려움 표현이 있어도, 그것만으로 어르신의 상태가 악화됐다거나 새로운 증상이 생겼다고 change에
  적지 마라 — change에는 실제로 관찰된 사실만, caregiverNote에는 요양보호사 본인의 경험만 담는다.
  표현이 없으면 빈 문자열로 둔다.

질문 규칙 (반드시 지킬 것):
1. 정보가 부족할 때만 질문한다. 이미 충분하면 바로 최종 보고문을 만든다.
2. 질문 우선순위는 참고용 기본값이다: (1) 발생 시간과 상황 (2) 관찰한 구체적 사실(정도·양 등)
   (3) 현장에서 한 조치 (4) 현재 상태 (5) 센터가 확인해야 할 사항. 다만 요양보호사가 이미 말한
   내용에서 가장 먼저 확인이 필요한 구체적 사실(예: "적게 드셨어요"처럼 정도·양이 핵심인 관찰)이
   있으면, 그 사실을 시간보다 먼저 물어도 된다 — 순서보다 "지금 이 발화에서 가장 궁금한 것"이
   우선이다.
3. 한 번에 질문은 반드시 하나만 한다.
4. 이미 답변된 내용은 다시 묻지 않는다(첫 발화나 이전 답변에 이미 답이 있으면 그 항목은 건너뛴다).
5. 요양보호사가 말하지 않은 사실을 추정하거나 지어내지 않는다. 요양보호사가 버튼으로 짧은
   선택지(예: "도와드렸어요")만 골랐다면, 그 선택지에 없는 구체적인 방법·수치·시간을 report에
   임의로 덧붙이지 않는다 — 짧게 답했으면 짧은 사실만 그대로 옮긴다.
6-1. 화면에서는 요양보호사가 다시 타이핑하지 않고 버튼을 눌러 답할 수 있어야 하므로,
    가능하면 항상 options에 실제로 있을 법한 답 2~4개를 짧게 채운다(예: "조금 적게/많이 적게").
    options는 반드시 그 question이 실제로 묻는 것과 의미가 일치해야 한다 — 예를 들어 "언제"를
    묻는 질문에는 시점 선택지만, "얼마나/어느 정도"를 묻는 질문에는 정도 선택지만 넣는다. 시점
    질문에 정도 선택지를 섞거나 그 반대로 섞지 않는다. 구체적 수치나 지어낸 정보를 옵션에 넣지
    말고, 정말 선택지로 표현하기 어려운 질문(예: 자유 서술이 꼭 필요한 경우)만 options를 비워
    자유 입력에 맡긴다.
6. 의료용어를 임의로 추가하지 않는다.
7. 진단명이나 질환 가능성을 판단하지 않는다.
8. 투약·치료·처치 변경을 권고하지 않는다.
9. 확인되지 않은 정보는 추정하지 말고 "확인되지 않음"으로 적는다.
10. 요양보호사가 "오늘은 특별히 달라진 점이 없었어요"처럼 특이사항이 없다고 말하면, 불필요한
    질문을 반복하지 말고 "금일 서비스 중 평소와 다른 상태변화는 관찰되지 않음"과 같이 짧게
    정리한다. 단, 실제로 언급되지 않은 식사·이동·의사소통 상태를 임의로 정상이라고 적지 말고
    "별도 확인하지 않음"으로 처리하거나 보고문에서 제외한다.
11. 요양보호사가 자신의 어려움이나 감정을 표현해도(예: "너무 힘들었어요"), 그 표현만으로
    어르신에게 상태변화나 질환이 생겼다고 추정하지 않는다. 어르신에 대한 실제 관찰 사실이
    별도로 언급됐을 때만 change에 적는다.
12. 요양보호사가 "그만할게요"/"여기까지 할게요"처럼 종료 의사를 밝히면 즉시 needFollowup=false로
    최종 보고문을 만든다. 지금까지 실제로 들은 내용은 반영하되, 그 시점까지 확인 못 한 항목은
    "확인되지 않음"으로 남기고 억지로 채우지 않는다.
13. 최초 발화나 답변이 돌봄과 무관한 내용(잡담, 날씨, 요양보호사 개인 용무, 시스템에 대한 불만
    등 어르신 관찰과 관계없는 말)이면, 그 내용으로 change/action/result를 지어내지 않는다. 대신
    needFollowup=true로 두고 question에 "그 말씀도 알겠습니다. 오늘 어르신은 어떠셨어요?"처럼
    짧게 인정한 뒤 담당 어르신 이야기로 자연스럽게 되돌아오는 질문을 담는다(비난하거나 길게
    설명하지 않는다). 무관한 말이 반복돼도 최종 보고문에는 그 잡담 내용을 채워 넣지 말고, 어르신에
    대한 관찰이 끝내 없었다면 "금일 관찰 내용이 확인되지 않음"처럼 사실대로 적는다.

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
    caregiverNote: '',
  }
}

export async function runCareReportTurn(
  rawInput: string,
  history: FollowupTurn[],
  clientForceFinalize = false,
): Promise<CareTurnResult> {
  // clientForceFinalize: 요양보호사가 "그만할게요"류 종료 의사를 밝혀 화면에서
  // 직접 조기종료를 트리거한 경우. 3회 상한 도달과 같은 방식으로 처리한다.
  const forceFinalize = clientForceFinalize || history.length >= MAX_FOLLOWUPS
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

  // 서버 측 안전장치: 3회를 넘겼거나(또는 클라이언트가 조기종료를 요청했거나) 질문하지 못하게 강제한다.
  if (forceFinalize && parsed.needFollowup) {
    const validAiReport = parsed.report && isValidReport(parsed.report)
    return {
      needFollowup: false,
      question: null,
      missingField: null,
      report: validAiReport ? { ...parsed.report!, caregiverNote: parsed.report!.caregiverNote ?? '' } : fallbackReport(rawInput, history),
      usedFallback: !validAiReport,
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
      options: sanitizeOptions(parsed.options),
      allowMultiple: parsed.allowMultiple === true,
      usedFallback: false,
    }
  }

  if (!parsed.report || !isValidReport(parsed.report)) {
    return { needFollowup: false, question: null, missingField: null, report: fallbackReport(rawInput, history), usedFallback: true }
  }
  return {
    needFollowup: false,
    question: null,
    missingField: null,
    report: { ...parsed.report, caregiverNote: parsed.report.caregiverNote ?? '' },
    usedFallback: false,
  }
}

/** AI가 준 options를 화면에 그대로 노출하기 전 마지막 방어선. 문자열이 아니거나
 * 비어있거나 지나치게 긴 항목은 버리고, 최대 4개까지만 남긴다(화면이 큰 버튼으로
 * 보여줘야 해서 항목이 많으면 오히려 고르기 어렵다). */
function sanitizeOptions(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const cleaned = v
    .filter((o): o is string => typeof o === 'string' && o.trim().length > 0 && o.trim().length <= 40)
    .map((o) => o.trim())
    .slice(0, 4)
  return cleaned.length >= 2 ? cleaned : undefined
}

function isValidReport(v: unknown): v is CareStructuredReport {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.change === 'string' &&
    typeof r.action === 'string' &&
    typeof r.result === 'string' &&
    typeof r.escalation === 'string' &&
    (r.caregiverNote === undefined || typeof r.caregiverNote === 'string')
  )
}
