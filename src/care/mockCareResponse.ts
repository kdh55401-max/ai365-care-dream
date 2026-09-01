import { checkEmergency, pickQuestionSetId, type QuestionSetId } from '../triage'

/**
 * 요양보호사(CARE) 업무공간의 "AI 대응안"은 이번 단계에서 실제 AI API를
 * 호출하지 않는다. 기존 triage.ts의 규칙 기반 상황 분류만 재사용해 미리
 * 준비된 데모 응답을 돌려주는 시뮬레이션이다. 화면에는 반드시 "MVP 데모"
 * 표시를 함께 보여준다.
 */
export type CareMockRiskLevel = '일반' | '기관 확인' | '우선 확인'

export interface CareMockResult {
  riskLevel: CareMockRiskLevel
  immediateAction: string
  avoidAction: string
  centerReport: string
}

const RESPONSES: Record<QuestionSetId, CareMockResult> = {
  fall: {
    riskLevel: '우선 확인',
    immediateAction:
      '어르신을 무리하게 움직이지 말고 편안한 자세로 안정시키세요. 통증이나 어지럼증이 심하면 119 신고를 우선하세요.',
    avoidAction: '다친 부위를 억지로 움직이거나 혼자 힘으로 일으켜 세우지 마세요.',
    centerReport:
      '낙상 발생, 통증 호소로 안전 확보 후 안내드립니다. 119 신고 필요 여부 확인 부탁드립니다.',
  },
  dizzy: {
    riskLevel: '기관 확인',
    immediateAction: '어르신을 앉히거나 눕혀 안정을 취하게 하고, 갑자기 심해지는지 계속 관찰하세요.',
    avoidAction: '어지럼증이 있는 상태에서 혼자 걷게 하거나 계단을 오르내리게 하지 마세요.',
    centerReport: '어지럼증 호소로 관찰 중입니다. 증상 변화가 있으면 다시 연락드리겠습니다.',
  },
  behavior: {
    riskLevel: '기관 확인',
    immediateAction: '차분한 목소리로 안심시키고, 넘어지거나 나가려는 위험이 없는지 주변을 확인하세요.',
    avoidAction: '어르신의 말이나 행동을 강하게 제지하거나 다그치지 마세요.',
    centerReport: '평소와 다른 행동 변화가 확인되어 안내드립니다. 원인 파악과 확인이 필요합니다.',
  },
  painFeverAbnormal: {
    riskLevel: '기관 확인',
    immediateAction: '증상이 언제부터 시작됐는지 확인하고, 열이나 통증 정도를 계속 관찰하세요.',
    avoidAction: '임의로 약을 먹이거나 처방되지 않은 조치를 하지 마세요.',
    centerReport: '평소와 다른 증상이 확인되어 안내드립니다. 확인 및 후속 조치를 부탁드립니다.',
  },
  unclear: {
    riskLevel: '일반',
    immediateAction: '지금 상태를 조금 더 지켜보고, 변화가 있으면 다시 확인해 주세요.',
    avoidAction: '특별히 하지 말아야 할 행동은 없지만, 상태 변화를 놓치지 않도록 주의하세요.',
    centerReport: '현재 특별한 위험 신호는 확인되지 않아 계속 관찰하겠습니다.',
  },
}

const EMERGENCY_RESPONSE: CareMockResult = {
  riskLevel: '우선 확인',
  immediateAction: '즉시 어르신의 의식과 호흡 상태를 확인하고, 안전한 자세를 유지하며 119 신고를 우선하세요.',
  avoidAction: '증상이 있는 부위를 흔들거나 억지로 움직이지 말고, 대응을 미루지 마세요.',
  centerReport: '응급 의심 증상이 확인되어 119 신고와 동시에 센터에 우선 보고드립니다.',
}

export function generateMockCareResponse(text: string): CareMockResult {
  if (checkEmergency(text)) return EMERGENCY_RESPONSE
  return RESPONSES[pickQuestionSetId(text)]
}
