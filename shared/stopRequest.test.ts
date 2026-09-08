import { describe, expect, it } from 'vitest'
import { detectStopRequest } from './stopRequest.js'

describe('detectStopRequest', () => {
  it('"그만할게요"는 종료요청', () => {
    expect(detectStopRequest('그만할게요')).toBe(true)
  })
  it('"여기까지 할게요"는 종료요청', () => {
    expect(detectStopRequest('여기까지 할게요')).toBe(true)
  })
  it('정보 + 종료요청이 한 문장에 있어도 감지된다', () => {
    expect(detectStopRequest('오늘 식사는 반 정도 하셨어요. 여기까지 할게요.')).toBe(true)
  })
  it('어르신의 말을 인용한 경우는 종료요청이 아니다', () => {
    expect(detectStopRequest('어르신이 "그만할게요"라고 하셨어요')).toBe(false)
  })
  it('단서가 없으면 false', () => {
    expect(detectStopRequest('오늘 점심을 잘 드셨어요.')).toBe(false)
  })
  it('빈 문자열은 false', () => {
    expect(detectStopRequest('')).toBe(false)
  })
})
