import { describe, expect, it } from 'vitest'
import { isLikelyOffTopic } from './offTopicEngine.js'

describe('isLikelyOffTopic', () => {
  it('날씨 잡담은 무관한 발화', () => {
    expect(isLikelyOffTopic('오늘 날씨가 정말 좋네요')).toBe(true)
  })
  it('축구 이야기는 무관한 발화', () => {
    expect(isLikelyOffTopic('어제 축구 경기 보셨어요?')).toBe(true)
  })
  it('돌봄 단서가 있으면 무관 단서가 섞여 있어도 무관한 발화가 아니다', () => {
    expect(isLikelyOffTopic('어르신이 날씨 이야기하시면서 식사도 잘 하셨어요')).toBe(false)
  })
  it('정상 관찰 문장은 무관한 발화가 아니다', () => {
    expect(isLikelyOffTopic('물을 적게 드셨어요')).toBe(false)
  })
  it('"특이사항 없어요"는 무관한 발화가 아니다', () => {
    expect(isLikelyOffTopic('특이사항 없어요')).toBe(false)
  })
  it('"잘 모르겠어요"처럼 애매한 짧은 답은 무관한 발화로 단정하지 않는다', () => {
    expect(isLikelyOffTopic('잘 모르겠어요')).toBe(false)
  })
  it('빈 문자열은 false', () => {
    expect(isLikelyOffTopic('')).toBe(false)
  })
})
