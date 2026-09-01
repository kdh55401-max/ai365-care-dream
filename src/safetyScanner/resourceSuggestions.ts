import type { FollowUpAction, RiskAssessment } from './types'

/**
 * 추천 후속조치 문구. 확정적인 지원 판정이 아니라 "검토"가 필요한 항목임을
 * 항상 함께 표시한다. 실제 지역자원 데이터베이스는 이번 단계에서 연결하지 않고
 * 문구만 제공한다.
 */
export const safetyResourceSuggestions: Record<string, FollowUpAction> = {
  homeModification: { id: 'homeModification', label: '주거환경개선 지원 검토' },
  grabBarOrAntiSlip: {
    id: 'grabBarOrAntiSlip',
    label: '안전손잡이 또는 미끄럼방지 설치 필요성 검토',
  },
  fireSafetyEquipment: {
    id: 'fireSafetyEquipment',
    label: '화재감지기 또는 응급안전장비 설치 검토',
  },
  guardianCheck: { id: 'guardianCheck', label: '보호자 확인 검토' },
  caseManagement: { id: 'caseManagement', label: '전담사회복지사 사례관리 검토' },
  nextVisitRecheck: { id: 'nextVisitRecheck', label: '다음 방문 재점검' },
}

const SIGNAL_TO_SUGGESTIONS: Record<string, string[]> = {
  mob_obstacle: ['homeModification', 'nextVisitRecheck'],
  mob_obstacle_confirmed: ['homeModification', 'nextVisitRecheck'],
  mob_bathroom: ['grabBarOrAntiSlip', 'nextVisitRecheck'],
  mob_bathroom_confirmed: ['grabBarOrAntiSlip', 'nextVisitRecheck'],
  mob_fall_pain_combo: ['caseManagement', 'guardianCheck'],
  gas_no_detector: ['fireSafetyEquipment'],
  gas_flammable: ['homeModification', 'nextVisitRecheck'],
  gas_valve_unchecked: ['caseManagement'],
  gas_emergency: ['caseManagement', 'guardianCheck'],
  elec_multitab: ['homeModification', 'nextVisitRecheck'],
  elec_wire_damage: ['homeModification', 'caseManagement'],
  elec_blanket_folded: ['nextVisitRecheck'],
  elec_flammable_nearby: ['homeModification', 'nextVisitRecheck'],
  elec_discolor_burn: ['caseManagement', 'guardianCheck'],
  elec_overheat: ['caseManagement', 'guardianCheck'],
}

/** 위험도 판정 결과를 바탕으로 추천 후속조치 목록을 만든다. 중복은 제거한다. */
export function buildFollowUpActions(assessment: RiskAssessment): FollowUpAction[] {
  if (assessment.level === 'LEVEL1') {
    return [safetyResourceSuggestions.nextVisitRecheck]
  }
  const ids = new Set<string>()
  for (const signal of assessment.signals) {
    for (const suggestionId of SIGNAL_TO_SUGGESTIONS[signal.id] ?? []) {
      ids.add(suggestionId)
    }
  }
  ids.add('nextVisitRecheck')
  return [...ids].map((id) => safetyResourceSuggestions[id])
}

export const IMMEDIATE_ACTION_OPTIONS = [
  '장애물 정리',
  '매트 정리',
  '이동 동선 재확인',
  '어르신에게 위험요소 안내',
  '전담사회복지사 보고',
  '보호자 확인 필요',
  '시설을 건드리지 않고 현장 보존',
  '기타',
]
