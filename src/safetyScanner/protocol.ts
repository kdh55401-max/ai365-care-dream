import type { ProtocolOption, ProtocolStep } from './types'

/**
 * 승인된 질문 프로토콜(1차 MVP: 낙상·이동 동선 / 가스·화재 / 전기 3개 영역).
 * AI는 이 목록에 정의된 질문과 선택지만 순서대로 제시하며, 임의로 점검항목을
 * 새로 만들지 않는다. 기관별 프로토콜 조정이나 영역 확장이 필요하면 이 배열만
 * 수정하면 된다.
 */

const MOBILITY_RISK_SIGNALS = [
  'mob_stagger',
  'mob_fall',
  'mob_dizzy',
  'mob_obstacle',
  'mob_bathroom',
]

// id는 항상 label로 둔다. 같은 질문 안에서는 선택지 문구가 서로 겹치지 않으므로
// (같은 signalId를 여러 선택지가 공유하는 경우가 있어) label을 키로 써야 화면
// 렌더링과 다중선택 토글에서 선택지가 서로 충돌하지 않는다.
function opt(label: string, signalId: string | null): ProtocolOption {
  return { id: label, label, signalId }
}

const mobilityHasRisk = (signals: string[]) =>
  signals.some((id) => MOBILITY_RISK_SIGNALS.includes(id))

export const SAFETY_SCANNER_PROTOCOL: ProtocolStep[] = [
  // A. 낙상·이동 동선
  {
    kind: 'question',
    id: 'mob_root',
    area: 'mobility',
    answerType: 'single',
    prompt:
      '오늘 어르신이 평소와 다르게 걷기 불편해하거나, 넘어지거나 휘청거린 일이 있었나요?',
    options: [
      opt('변화 없음', 'mob_none'),
      opt('휘청거림', 'mob_stagger'),
      opt('실제 낙상', 'mob_fall'),
      opt('어지럼증', 'mob_dizzy'),
      opt('이동 동선 장애물', 'mob_obstacle'),
      opt('욕실 또는 화장실 위험', 'mob_bathroom'),
      opt('잘 모르겠음', 'mob_unknown'),
    ],
  },
  {
    kind: 'question',
    id: 'mob_recent_fall',
    area: 'mobility',
    answerType: 'single',
    prompt: '최근 실제로 바닥에 넘어진 적이 있나요?',
    askIf: mobilityHasRisk,
    options: [opt('예', 'mob_fall_confirmed'), opt('아니요', null), opt('잘 모르겠어요', null)],
  },
  {
    kind: 'question',
    id: 'mob_pain_now',
    area: 'mobility',
    answerType: 'single',
    prompt: '지금 통증이나 어지럼증을 호소하시나요?',
    askIf: mobilityHasRisk,
    options: [opt('예', 'mob_pain_now'), opt('아니요', null), opt('잘 모르겠어요', null)],
  },
  {
    kind: 'question',
    id: 'mob_path_obstacle',
    area: 'mobility',
    answerType: 'single',
    prompt: '침실에서 화장실까지 이동하는 길에 매트, 전선 또는 장애물이 있나요?',
    askIf: mobilityHasRisk,
    options: [
      opt('예', 'mob_obstacle_confirmed'),
      opt('아니요', null),
      opt('잘 모르겠어요', null),
    ],
  },
  {
    kind: 'photo',
    id: 'mob_path_obstacle_photo',
    area: 'mobility',
    prompt:
      '이동 동선의 위험요소를 기록하겠습니다. 어르신의 얼굴, 신분증, 우편물 등 개인정보가 나오지 않도록 위험한 부분만 촬영해 주세요.',
    askIf: (signals) => signals.includes('mob_obstacle') || signals.includes('mob_obstacle_confirmed'),
  },
  {
    kind: 'question',
    id: 'mob_bathroom_check',
    area: 'mobility',
    answerType: 'single',
    prompt: '욕실 바닥이 미끄럽거나 손잡이가 필요한 상태인가요?',
    askIf: mobilityHasRisk,
    options: [
      opt('예', 'mob_bathroom_confirmed'),
      opt('아니요', null),
      opt('잘 모르겠어요', null),
    ],
  },
  {
    kind: 'photo',
    id: 'mob_bathroom_photo',
    area: 'mobility',
    prompt:
      '이동 동선의 위험요소를 기록하겠습니다. 어르신의 얼굴, 신분증, 우편물 등 개인정보가 나오지 않도록 위험한 부분만 촬영해 주세요.',
    askIf: (signals) => signals.includes('mob_bathroom') || signals.includes('mob_bathroom_confirmed'),
  },

  // B. 가스·화재
  {
    kind: 'question',
    id: 'gas_root',
    area: 'gasFire',
    answerType: 'single',
    prompt: '가스 냄새, 연기, 타는 냄새 또는 화재 위험이 의심되는 상황이 있나요?',
    options: [
      opt('예, 의심됩니다', 'gas_emergency'),
      opt('아니요', null),
      opt('잘 모르겠어요', 'gas_uncertain'),
    ],
  },
  {
    kind: 'question',
    id: 'gas_flammable',
    area: 'gasFire',
    answerType: 'single',
    prompt: '가스레인지 주변에 종이, 비닐 또는 천과 같은 불에 타기 쉬운 물건이 있나요?',
    askIf: (signals) => !signals.includes('gas_emergency'),
    options: [opt('예', 'gas_flammable'), opt('아니요', null), opt('잘 모르겠어요', null)],
  },
  {
    kind: 'question',
    id: 'gas_valve',
    area: 'gasFire',
    answerType: 'single',
    prompt: '가스 밸브와 가스 호스의 상태를 눈으로 확인할 수 있나요?',
    askIf: (signals) => !signals.includes('gas_emergency'),
    options: [
      opt('예, 이상 없어요', null),
      opt('아니요, 확인하기 어려워요', 'gas_valve_unchecked'),
      opt('잘 모르겠어요', 'gas_valve_unchecked'),
    ],
  },
  {
    kind: 'question',
    id: 'gas_detector',
    area: 'gasFire',
    answerType: 'single',
    prompt: '화재감지기 또는 가스감지기가 설치되어 있나요?',
    askIf: (signals) => !signals.includes('gas_emergency'),
    options: [
      opt('예', null),
      opt('아니요', 'gas_no_detector'),
      opt('잘 모르겠어요', 'gas_no_detector'),
    ],
  },
  {
    kind: 'photo',
    id: 'gas_standard_photo',
    area: 'gasFire',
    prompt:
      '가스레인지 주변 표준사진을 기록하겠습니다. 어르신의 얼굴, 신분증, 우편물 등 개인정보가 나오지 않도록 위험한 부분만 촬영해 주세요.',
    askIf: (signals) => !signals.includes('gas_emergency'),
  },

  // C. 전기
  {
    kind: 'question',
    id: 'elec_root',
    area: 'electrical',
    answerType: 'multi',
    prompt: '콘센트, 멀티탭 또는 난방기기 주변에 이상이 보이나요? 해당하는 항목을 모두 선택해 주세요.',
    options: [
      opt('문어발식 멀티탭', 'elec_multitab'),
      opt('전선 피복 손상', 'elec_wire_damage'),
      opt('콘센트나 플러그의 변색 또는 그을림', 'elec_discolor_burn'),
      opt('플러그나 멀티탭의 비정상적인 열감 또는 스파크', 'elec_overheat'),
      opt('전기장판 접힘', 'elec_blanket_folded'),
      opt('난방기 주변 가연물', 'elec_flammable_nearby'),
      opt('이상 없음', 'elec_none'),
      opt('잘 모르겠음', 'elec_unknown'),
    ],
  },
  {
    kind: 'photo',
    id: 'elec_photo',
    area: 'electrical',
    prompt:
      '전기 관련 위험요소를 기록하겠습니다. 어르신의 얼굴, 신분증, 우편물 등 개인정보가 나오지 않도록 문제 부분만 촬영해 주세요.',
    askIf: (signals) =>
      [
        'elec_multitab',
        'elec_wire_damage',
        'elec_discolor_burn',
        'elec_overheat',
        'elec_blanket_folded',
        'elec_flammable_nearby',
      ].some((id) => signals.includes(id)),
  },
]

/** 개인정보 주의 문구 (모든 사진 촬영 화면 공통) */
export const PHOTO_PRIVACY_NOTICE =
  '어르신의 얼굴, 가족사진, 신분증, 처방전, 우편물 등 개인정보가 포함되지 않도록 위험요소만 촬영해 주세요.'
