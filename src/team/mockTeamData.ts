/**
 * 관리자(TEAM) 업무함 목데이터. 실제 백엔드 연동 전, 화면 흐름을 시연하기
 * 위한 예시 데이터다. 나중에 실제 API 응답으로 교체할 수 있도록 화면
 * 컴포넌트와 데이터 구조를 분리해 두었다.
 */

export type TeamPriority = '우선 확인 필요' | '기관 확인 필요' | '일반 관찰'
export type TeamCategory = '긴급 확인' | '승인 대기' | '오늘 마감' | 'AI 업무팀 처리 결과'
export type TeamTaskStatus = 'pending' | 'approved' | 'revisionRequested'

export interface TeamTask {
  id: string
  category: TeamCategory
  title: string
  subtitle: string
  priority: TeamPriority
  /** 현장 원문 또는 보고 내용 */
  rawReport: string
  /** AI가 정리한 내용 */
  aiSummary: string
  status: TeamTaskStatus
  revisionNote?: string
}

export const TEAM_CATEGORY_ORDER: TeamCategory[] = [
  '긴급 확인',
  '승인 대기',
  '오늘 마감',
  'AI 업무팀 처리 결과',
]

export const INITIAL_TEAM_TASKS: TeamTask[] = [
  {
    id: 't1',
    category: '긴급 확인',
    title: '김○○ 어르신 낙상 의심 보고',
    subtitle: '요양보호사 · 10분 전',
    priority: '우선 확인 필요',
    rawReport:
      '방문 중 어르신이 화장실 앞에서 휘청거리다 주저앉았습니다. 지금은 통증을 호소하고 계십니다.',
    aiSummary: '낙상 후 통증 호소가 확인되어 즉시 상태 확인과 119 연계 여부 판단이 필요합니다.',
    status: 'pending',
  },
  {
    id: 't2',
    category: '승인 대기',
    title: '박○○ 어르신 생활안전 점검 결과',
    subtitle: '생활지원사 · 40분 전',
    priority: '기관 확인 필요',
    rawReport:
      '욕실 앞 매트가 들떠 있어 정리했고, 최근 며칠 어지럼증을 호소하셨다고 합니다.',
    aiSummary: '이동 동선 위험요소는 조치 완료되었고, 어지럼증은 계속 관찰이 필요합니다.',
    status: 'pending',
  },
  {
    id: 't3',
    category: '오늘 마감',
    title: '이○○ 어르신 정기 방문 기록',
    subtitle: '요양보호사 · 오늘 12:00 마감',
    priority: '일반 관찰',
    rawReport: '평소와 다르지 않으며 식사와 활동 모두 양호합니다.',
    aiSummary: '특이사항이 없어 기록만 완료하면 되는 건입니다.',
    status: 'pending',
  },
  {
    id: 't4',
    category: 'AI 업무팀 처리 결과',
    title: '최○○ 어르신 전기 위험 신고 자동분류',
    subtitle: 'AI 자동 처리 · 1시간 전',
    priority: '기관 확인 필요',
    rawReport:
      '콘센트 주변 멀티탭이 문어발식으로 연결되어 있는 것을 생활지원사가 촬영해 보고했습니다.',
    aiSummary: 'AI가 위험도를 기관 확인 필요로 자동 분류했습니다. 관리자 확인 후 승인해 주세요.',
    status: 'pending',
  },
]
