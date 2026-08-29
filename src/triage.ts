import type { RiskLevel } from './gemini'

/**
 * 데모용 규칙 기반 1차 분류. 의료 진단이 아니라, 사용자가 말한 위험 신호를
 * 근거로 "추가 확인 질문" 단계를 건너뛰고 119 안내를 우선 표시할지 정하는
 * 용도로만 쓴다. 확인되지 않은 증상을 임의로 추가하지 않기 위해, 문장에
 * 명확히 포함된 표현만 정규식으로 감지한다.
 */
const EMERGENCY_PATTERNS: RegExp[] = [
  /반응이?\s*없|불러도\s*반응|의식이?\s*없|의식[\s\S]{0,4}저하/,
  /숨(을)?\s*(잘\s*)?(못\s*쉬|쉬지\s*않)|호흡\s*곤란|숨이?\s*가빠|숨\s*쉬기\s*힘들/,
  /한쪽\s*(팔|다리|손|발)[\s\S]{0,10}(힘이?\s*없|저하|마비|움직이지\s*않|움직임)/,
  /(안면|얼굴)[\s\S]{0,6}(비대칭|처짐|마비|돌아)|말이?\s*어눌|발음이?\s*어눌|발음[\s\S]{0,6}이상/,
  /(출혈|피)[\s\S]{0,10}(멈추지\s*않|안\s*멈추|계속)|심한\s*출혈/,
]

export function checkEmergency(text: string): boolean {
  return EMERGENCY_PATTERNS.some((re) => re.test(text))
}

export type QuestionSetId = 'fall' | 'dizzy' | 'behavior' | 'painFeverAbnormal' | 'unclear'

export interface QuestionChoice {
  label: string
  tier: RiskLevel
}

export interface QuestionDef {
  text: string
  choices: QuestionChoice[]
}

function choices(yesTier: RiskLevel, noTier: RiskLevel): QuestionChoice[] {
  return [
    { label: '네', tier: yesTier },
    { label: '아니요', tier: noTier },
    { label: '잘 모르겠어요', tier: '기관 확인 필요' },
  ]
}

const QUESTION_SET_DEFS: Record<QuestionSetId, QuestionDef[]> = {
  fall: [
    {
      text: '머리를 부딪혔거나 출혈이 있나요?',
      choices: choices('우선 확인 필요', '일반 관찰'),
    },
    {
      text: '심한 통증 때문에 움직이기 어렵나요?',
      choices: choices('기관 확인 필요', '일반 관찰'),
    },
  ],
  dizzy: [
    {
      text: '지금 혼자 서거나 걷기 어려운가요?',
      choices: choices('기관 확인 필요', '일반 관찰'),
    },
    {
      text: '증상이 갑자기 시작되었거나 빠르게 심해지고 있나요?',
      choices: choices('기관 확인 필요', '일반 관찰'),
    },
  ],
  painFeverAbnormal: [
    {
      text: '증상이 갑자기 시작되었거나 계속 심해지고 있나요?',
      choices: choices('기관 확인 필요', '일반 관찰'),
    },
    {
      text: '의식이나 호흡 상태는 평소와 같은가요?',
      choices: choices('일반 관찰', '우선 확인 필요'),
    },
  ],
  behavior: [
    {
      text: '현재 외출하거나 넘어질 위험이 있나요?',
      choices: choices('기관 확인 필요', '일반 관찰'),
    },
    {
      text: '평소보다 갑자기 심해진 변화인가요?',
      choices: choices('기관 확인 필요', '일반 관찰'),
    },
  ],
  unclear: [
    {
      text: '현재 의식과 호흡 상태는 평소와 같은가요?',
      choices: choices('일반 관찰', '우선 확인 필요'),
    },
  ],
}

const QUESTION_SET_KEYWORDS: Array<{ id: QuestionSetId; keywords: string[] }> = [
  { id: 'fall', keywords: ['낙상', '넘어', '쓰러', '떨어'] },
  { id: 'dizzy', keywords: ['어지럽', '어지러', '기운이', '기운없', '휘청', '힘없', '힘이 없'] },
  { id: 'behavior', keywords: ['배회', '나가려', '반복', '불안해', '같은 말', '집 밖', '집밖'] },
  {
    id: 'painFeverAbnormal',
    keywords: ['아프', '통증', '열이', '발열', '평소와 다르', '평소랑 다르', '이상해'],
  },
]

export function pickQuestionSetId(text: string): QuestionSetId {
  for (const { id, keywords } of QUESTION_SET_KEYWORDS) {
    if (keywords.some((k) => text.includes(k))) return id
  }
  return 'unclear'
}

export function pickQuestions(text: string): QuestionDef[] {
  return QUESTION_SET_DEFS[pickQuestionSetId(text)]
}

const TIER_SEVERITY: Record<RiskLevel, number> = {
  '일반 관찰': 1,
  '기관 확인 필요': 2,
  '우선 확인 필요': 3,
}

export function mostSevereTier(tiers: RiskLevel[]): RiskLevel {
  return tiers.reduce<RiskLevel>(
    (worst, t) => (TIER_SEVERITY[t] > TIER_SEVERITY[worst] ? t : worst),
    '일반 관찰',
  )
}
