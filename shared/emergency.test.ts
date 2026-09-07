import { describe, expect, it } from 'vitest'
import { detectEmergencyPhrase } from './emergency.js'

describe('detectEmergencyPhrase — 5개 응급 카테고리 양성/음성 대조', () => {
  it('의식저하: 양성', () => {
    expect(detectEmergencyPhrase('불러도 의식이 없어요')).toBe(true)
  })
  it('의식저하: 음성(부정문, 같은 절)', () => {
    expect(detectEmergencyPhrase('의식 저하는 없었어요')).toBe(false)
  })
  it('호흡곤란: 양성', () => {
    expect(detectEmergencyPhrase('숨을 잘 못 쉬어요')).toBe(true)
  })
  it('호흡곤란: 음성(부정문, 같은 절)', () => {
    expect(detectEmergencyPhrase('숨쉬기 힘든 건 없었어요')).toBe(false)
  })
  it('편측마비: 양성', () => {
    expect(detectEmergencyPhrase('한쪽 팔에 힘이 없어요')).toBe(true)
  })
  it('편측마비: 음성(부정문, 같은 절)', () => {
    expect(detectEmergencyPhrase('한쪽 다리 마비는 없었어요')).toBe(false)
  })
  it('안면비대칭·발음이상: 양성', () => {
    expect(detectEmergencyPhrase('발음이 어눌해요')).toBe(true)
  })
  it('안면비대칭·발음이상: 음성(부정문, 같은 절)', () => {
    expect(detectEmergencyPhrase('발음이 어눌하지는 않았어요')).toBe(false)
  })
  it('출혈: 양성', () => {
    expect(detectEmergencyPhrase('피가 계속 나요')).toBe(true)
  })
  it('출혈: 음성(부정문, 같은 절)', () => {
    expect(detectEmergencyPhrase('출혈이 안 멈추는 건 아니었어요')).toBe(false)
  })
  it('다른 절의 부정은 매치를 무효화하지 않는다', () => {
    // "보호자가 없다"는 부정이지만 응급 신호("의식이 없다")와는 다른 절이다.
    expect(detectEmergencyPhrase('의식이 없어요. 보호자는 연락이 안 됐어요.')).toBe(true)
  })
  it('빈 문자열은 false', () => {
    expect(detectEmergencyPhrase('')).toBe(false)
  })
})
