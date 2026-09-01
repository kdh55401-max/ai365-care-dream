import type { RiskAssessment, RiskLevelCode, RiskSignal, SafetyArea } from './types'

/**
 * 승인된 위험규칙 데이터. 위험도는 AI 문장 생성이 아니라 이 표에 정의된
 * 규칙으로만 결정한다. 새 위험신호를 추가하거나 기관별 프로토콜을 조정할 때는
 * 이 파일만 수정하면 되고, UI 컴포넌트는 손대지 않아도 된다.
 */
export const SAFETY_RISK_SIGNALS: Record<string, RiskSignal> = {
  // 낙상·이동 동선
  mob_none: { id: 'mob_none', area: 'mobility', label: '변화 없음', level: 'LEVEL1' },
  mob_stagger: { id: 'mob_stagger', area: 'mobility', label: '휘청거림', level: 'LEVEL2' },
  mob_fall: { id: 'mob_fall', area: 'mobility', label: '실제 낙상', level: 'LEVEL2' },
  mob_dizzy: { id: 'mob_dizzy', area: 'mobility', label: '어지럼증', level: 'LEVEL2' },
  mob_obstacle: {
    id: 'mob_obstacle',
    area: 'mobility',
    label: '이동 동선 장애물',
    level: 'LEVEL2',
  },
  mob_bathroom: {
    id: 'mob_bathroom',
    area: 'mobility',
    label: '욕실 또는 화장실 위험',
    level: 'LEVEL2',
  },
  mob_unknown: { id: 'mob_unknown', area: 'mobility', label: '잘 모르겠음', level: 'LEVEL2' },
  mob_fall_confirmed: {
    id: 'mob_fall_confirmed',
    area: 'mobility',
    label: '최근 실제 낙상 확인됨',
    level: 'LEVEL2',
  },
  mob_pain_now: {
    id: 'mob_pain_now',
    area: 'mobility',
    label: '현재 통증 또는 어지럼증 호소',
    level: 'LEVEL2',
  },
  mob_obstacle_confirmed: {
    id: 'mob_obstacle_confirmed',
    area: 'mobility',
    label: '이동 동선에 매트·전선·장애물 확인됨',
    level: 'LEVEL2',
  },
  mob_bathroom_confirmed: {
    id: 'mob_bathroom_confirmed',
    area: 'mobility',
    label: '욕실 바닥 미끄럼 또는 손잡이 필요 확인됨',
    level: 'LEVEL2',
  },
  // 낙상 + 현재 통증/어지럼증이 함께 확인된 경우의 파생 신호 (deriveSignals에서 추가)
  mob_fall_pain_combo: {
    id: 'mob_fall_pain_combo',
    area: 'mobility',
    label: '낙상 후 통증을 호소하며 움직이기 어려운 상태',
    level: 'LEVEL3',
    emergency: true,
  },

  // 가스·화재
  gas_emergency: {
    id: 'gas_emergency',
    area: 'gasFire',
    label: '가스 냄새, 연기 또는 화재 위험 의심',
    level: 'LEVEL3',
    emergency: true,
  },
  gas_uncertain: {
    id: 'gas_uncertain',
    area: 'gasFire',
    label: '가스·화재 위험 여부를 잘 모르겠음',
    level: 'LEVEL2',
  },
  gas_flammable: {
    id: 'gas_flammable',
    area: 'gasFire',
    label: '가스레인지 주변 가연물',
    level: 'LEVEL2',
  },
  gas_valve_unchecked: {
    id: 'gas_valve_unchecked',
    area: 'gasFire',
    label: '가스 밸브·호스 상태 확인 불가',
    level: 'LEVEL2',
  },
  gas_no_detector: {
    id: 'gas_no_detector',
    area: 'gasFire',
    label: '화재감지기·가스감지기 미설치',
    level: 'LEVEL2',
  },

  // 전기
  elec_none: { id: 'elec_none', area: 'electrical', label: '이상 없음', level: 'LEVEL1' },
  elec_unknown: { id: 'elec_unknown', area: 'electrical', label: '잘 모르겠음', level: 'LEVEL2' },
  elec_multitab: {
    id: 'elec_multitab',
    area: 'electrical',
    label: '문어발식 멀티탭',
    level: 'LEVEL2',
  },
  elec_wire_damage: {
    id: 'elec_wire_damage',
    area: 'electrical',
    label: '전선 피복 손상',
    level: 'LEVEL2',
  },
  elec_blanket_folded: {
    id: 'elec_blanket_folded',
    area: 'electrical',
    label: '전기장판 접힘',
    level: 'LEVEL2',
  },
  elec_flammable_nearby: {
    id: 'elec_flammable_nearby',
    area: 'electrical',
    label: '난방기 주변 가연물',
    level: 'LEVEL2',
  },
  elec_discolor_burn: {
    id: 'elec_discolor_burn',
    area: 'electrical',
    label: '콘센트나 플러그의 변색 또는 그을림',
    level: 'LEVEL3',
    emergency: true,
  },
  elec_overheat: {
    id: 'elec_overheat',
    area: 'electrical',
    label: '플러그나 멀티탭의 비정상적인 열감 또는 스파크',
    level: 'LEVEL3',
    emergency: true,
  },
}

const LEVEL_SEVERITY: Record<RiskLevelCode, number> = { LEVEL1: 1, LEVEL2: 2, LEVEL3: 3 }

/**
 * 답변으로 직접 선택되지 않았지만 규칙상 함께 봐야 하는 파생 신호를 계산한다.
 * 예: 최근 낙상 + 현재 통증/어지럼증 호소 → 우선 확인 필요(LEVEL3).
 */
export function deriveSignalIds(rawSignalIds: string[]): string[] {
  const derived = [...rawSignalIds]
  const hasFall = rawSignalIds.includes('mob_fall') || rawSignalIds.includes('mob_fall_confirmed')
  const hasPainNow = rawSignalIds.includes('mob_pain_now')
  if (hasFall && hasPainNow && !derived.includes('mob_fall_pain_combo')) {
    derived.push('mob_fall_pain_combo')
  }
  return derived
}

export function hasEmergencySignal(signalIds: string[]): boolean {
  return signalIds.some((id) => SAFETY_RISK_SIGNALS[id]?.emergency)
}

export function assessRisk(rawSignalIds: string[]): RiskAssessment {
  const signalIds = deriveSignalIds(rawSignalIds)
  const signals = signalIds
    .map((id) => SAFETY_RISK_SIGNALS[id])
    .filter((s): s is RiskSignal => Boolean(s) && s.level !== 'LEVEL1')

  const level = signals.reduce<RiskLevelCode>(
    (worst, s) => (LEVEL_SEVERITY[s.level] > LEVEL_SEVERITY[worst] ? s.level : worst),
    'LEVEL1',
  )

  return { level, signals, isEmergency: hasEmergencySignal(signalIds) }
}

export interface RiskLevelMeta {
  label: string
  shortLabel: string
  bubbleClass: string
  barClass: string
  buttonClass: string
  processingStatus: '기록 완료' | '기관 확인 대기' | '우선 확인 필요'
  actions: string[]
}

export const RISK_LEVEL_META: Record<RiskLevelCode, RiskLevelMeta> = {
  LEVEL1: {
    label: '일반',
    shortLabel: 'LEVEL 1 · 일반',
    bubbleClass: 'bg-teal-50 text-teal-800 border-teal-200',
    barClass: 'bg-teal-500',
    buttonClass: 'bg-teal-600 hover:bg-teal-700',
    processingStatus: '기록 완료',
    actions: ['기록 후 다음 방문에서 일반 관찰'],
  },
  LEVEL2: {
    label: '기관 확인',
    shortLabel: 'LEVEL 2 · 기관 확인',
    bubbleClass: 'bg-orange-50 text-orange-800 border-orange-200',
    barClass: 'bg-orange-500',
    buttonClass: 'bg-orange-600 hover:bg-orange-700',
    processingStatus: '기관 확인 대기',
    actions: [
      '전담사회복지사 확인 필요',
      '현장조치 기록',
      '다음 방문 재점검',
      '주거환경개선 또는 지역자원 연계 검토',
    ],
  },
  LEVEL3: {
    label: '우선 확인·119',
    shortLabel: 'LEVEL 3 · 우선 확인·119',
    bubbleClass: 'bg-red-50 text-red-800 border-red-200',
    barClass: 'bg-red-600',
    buttonClass: 'bg-red-600 hover:bg-red-700',
    processingStatus: '우선 확인 필요',
    actions: [
      '위험 상황에서는 점검을 중단',
      '안전한 장소로 이동',
      '119 신고 우선',
      '수행기관 동시보고',
      '사진 촬영 때문에 대응이 지연되지 않도록 안내',
    ],
  },
}

/** 긴급안내 화면에서 보여줄, 위험영역별 맞춤 안내 문구 */
export const EMERGENCY_GUIDANCE: Record<SafetyArea, string[]> = {
  gasFire: [
    '위험한 장소에서 즉시 벗어나세요.',
    '어르신의 안전을 먼저 확보하세요.',
    '화재 또는 가스 위험이 있으면 119 신고를 우선하세요.',
    '전담사회복지사 또는 수행기관에 동시에 보고하세요.',
    '사진 촬영을 위해 위험한 장소에 머물지 마세요.',
    '가스·전기시설을 임의로 수리하거나 조작하지 마세요.',
  ],
  electrical: [
    '해당 시설을 임의로 만지거나 수리하지 마세요.',
    '전원을 뽑을 수 있는 상황이 아니라면 무리하게 조작하지 마세요.',
    '어르신을 위험한 시설에서 먼저 떨어지게 하세요.',
    '전담사회복지사 또는 수행기관에 우선 보고하세요.',
    '사진은 문제 부분만 안전한 거리에서 촬영하세요.',
  ],
  mobility: [
    '어르신을 무리하게 움직이지 말고 편안한 자세로 안정시키세요.',
    '통증이 심하거나 움직이기 어려우면 119 신고를 우선하세요.',
    '전담사회복지사 또는 수행기관에 동시에 보고하세요.',
    '사진 촬영 때문에 응급 대응이 늦어지지 않도록 하세요.',
  ],
}
