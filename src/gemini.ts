import { CARE_KNOWLEDGE } from './careKnowledge'

export type RiskLevel = '일반 관찰' | '기관 확인 필요' | '우선 확인 필요'

export interface CareResponse {
  riskLevel: RiskLevel
  immediateAction: string
  checks: string[]
  reportSentence: string
}

const MODEL = 'gemini-3.6-flash'

// 스키마 enum에 한글을 넣으면 이 모델에서 깨진 값이 나오는 경우가 있어
// 영문 코드로 받고 한글 라벨로 변환한다.
const RISK_CODE_TO_LABEL: Record<string, RiskLevel> = {
  OBSERVE: '일반 관찰',
  CHECK_NEEDED: '기관 확인 필요',
  URGENT: '우선 확인 필요',
}

const RISK_LABEL_TO_CODE: Record<RiskLevel, string> = {
  '일반 관찰': 'OBSERVE',
  '기관 확인 필요': 'CHECK_NEEDED',
  '우선 확인 필요': 'URGENT',
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    riskLevel: {
      type: 'STRING',
      enum: ['OBSERVE', 'CHECK_NEEDED', 'URGENT'],
      description:
        '상황의 위험도. OBSERVE=일반 관찰, CHECK_NEEDED=기관 확인 필요, URGENT=우선 확인 필요',
    },
    immediateAction: {
      type: 'STRING',
      description: '요양보호사가 지금 당장 취해야 할 행동, 1~2문장. 반드시 한국어로 작성.',
    },
    checks: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '추가로 확인해야 할 항목 목록 (2~4개). 반드시 한국어로 작성.',
    },
    reportSentence: {
      type: 'STRING',
      description:
        '사회복지사·센터장에게 전달할 보고 문장 1개(보고 "예시"이지 실행 완료 기록이 아님). ' +
        '아직 119 신고나 다른 조치가 실제로 이루어졌는지 알 수 없으므로, "신고하였습니다", ' +
        '"조치했습니다"처럼 이미 완료된 행동으로 절대 단정하지 말 것. 대신 관찰된 상황과 ' +
        '판단 근거를 설명하고 필요한 조치를 안내하는 현재형 문장으로 쓴다. ' +
        '예시: "대상자에게 갑작스러운 좌측 팔 움직임 저하, 안면 비대칭, 발음 어눌함이 확인되어 ' +
        '뇌졸중 의심 상황으로 판단됩니다. 즉시 119 신고가 필요한 상황이며 센터에 우선 보고드립니다." ' +
        '사용자가 말하지 않은 증상이나 실시하지 않은 조치를 임의로 추가하지 말 것. 반드시 한국어로 작성.',
    },
  },
  required: ['riskLevel', 'immediateAction', 'checks', 'reportSentence'],
}

const SYSTEM_PROMPT = `너는 장기요양기관 방문요양 현장을 지원하는 AI다.
요양보호사가 어르신의 현재 상황을 자유롭게 설명하면, 그 설명 내용에 정확히 근거해서:
1) 위험도를 3단계 중 하나로 분류하고
2) 지금 취해야 할 행동을 안내하고
3) 추가로 확인할 사항을 정리하고
4) 사회복지사/센터장에게 전달할 보고 문장을 만든다.

위험도 3단계는 반드시 아래 기준으로 구분한다.

- OBSERVE(일반 관찰): 평소와 다르지 않거나 경미한 변화. 특별한 조치 없이
  계속 지켜보기만 하면 되는 수준. (예: 평소보다 살짝 입맛 없음, 가벼운 짜증)
- CHECK_NEEDED(기관 확인 필요): 평소와 다른 변화가 있고 원인이 분명치 않거나
  반복됨. 응급 상황은 아니지만 기관(사회복지사·센터장)의 판단이나 기록이 필요한
  수준. (예: 며칠째 식사량 감소, 평소와 다른 행동, 애매한 컨디션 저하)
- URGENT(우선 확인 필요): 즉시 의료적 대응이 필요할 수 있는 응급 신호.
  (예: 낙상, 의식 저하, 마비·언어장애, 호흡곤란, 심한 통증)

절대로 사용자가 설명하지 않은 다른 상황(예: 코피, 화재, 누수 등)을 지어내지 마라.
반드시 사용자가 입력한 상황에만 근거해서 답하라.
너는 사람을 대신해 최종 판단을 내리는 것이 아니라, 현장의 1차 판단을 돕는 역할이다.
위 세 기준 중 어디에도 애매하게 걸치면 보수적으로(더 높은 위험도로) 분류한다.
보고 문장(reportSentence)은 아직 실행되지 않은 조치를 이미 끝난 일처럼 과거형으로 쓰지 마라.
요양보호사는 이 문장을 참고만 하고, 119 신고나 센터 연락은 화면을 보고 직접 판단해서 한다.
모든 텍스트는 한국어로 작성하고, 반드시 지정된 JSON 스키마 형식으로만 답한다.

아래는 요양보호사 양성표준교재와 치매 관련 교육자료에서 발췌한 참고 지식이다.
위험도 분류, 즉시 행동, 확인사항, 보고 문장을 만들 때 이 지식과 일치하도록 판단 근거로
삼아라. 단, 이 지식에 있는 사례를 사용자가 말하지 않은 상황에 임의로 갖다 붙이지 말고,
어디까지나 사용자가 입력한 내용을 해석하고 대응하는 데에만 참고하라.

${CARE_KNOWLEDGE}`

export interface GenerateOptions {
  /**
   * "추가 확인 질문" 데모 규칙으로 이미 결정된 위험도. 지정하면 riskLevel은
   * Gemini 응답과 무관하게 이 값으로 고정되고, 프롬프트에도 이 값을 그대로
   * 쓰라고 함께 안내해 즉시 행동·확인사항·보고 문장이 이 위험도와 어긋나지
   * 않게 한다.
   */
  forcedRiskLevel?: RiskLevel
  /** 추가 확인 질문과 답변 요약. AI가 대응 내용을 만들 때 참고하도록 상황 설명에 덧붙인다. */
  qaSummary?: string
}

export async function generateCareResponse(
  situation: string,
  apiKey: string,
  options?: GenerateOptions,
): Promise<CareResponse> {
  let userText = `요양보호사가 보고한 상황: "${situation}"`
  if (options?.qaSummary) {
    userText += `\n\n현장에서 추가로 확인한 질문과 답변:\n${options.qaSummary}`
  }
  if (options?.forcedRiskLevel) {
    userText +=
      `\n\n[중요] 이 상황의 위험도는 이미 "${RISK_LABEL_TO_CODE[options.forcedRiskLevel]}"` +
      `(${options.forcedRiskLevel})로 확정되었다. riskLevel 필드는 반드시 이 값으로 응답하고, ` +
      `그 위험도 수준에 맞는 즉시 행동·확인사항·보고 문장을 작성하라.`
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API 호출 실패 (${res.status}): ${body}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error('AI 응답에서 결과를 찾지 못했습니다.')
  }

  const parsed = JSON.parse(text)
  const riskLevel = options?.forcedRiskLevel ?? RISK_CODE_TO_LABEL[parsed.riskLevel]
  if (!riskLevel) {
    throw new Error(`알 수 없는 위험도 값입니다: ${parsed.riskLevel}`)
  }

  return { ...parsed, riskLevel }
}
