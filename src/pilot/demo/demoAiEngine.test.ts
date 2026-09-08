import { describe, expect, it } from 'vitest'
import { runDemoAiTurn } from './demoAiEngine.js'

describe('runDemoAiTurn — 돌봄과 무관한 발화', () => {
  it('첫 발화가 무관하면(날씨) 되묻고, 그 발화를 change에 담지 않는다', () => {
    const result = runDemoAiTurn('오늘 날씨가 정말 좋네요', [])
    expect(result.needFollowup).toBe(true)
    expect(result.missingField).toBe('offtopic_redirect')
    expect(result.report).toBeNull()
  })

  it('되물은 뒤 실제 돌봄 내용으로 답하면, 최종 보고문의 change는 그 답변을 기준으로 하고 원래 무관한 발화를 담지 않는다', () => {
    const first = runDemoAiTurn('오늘 날씨가 정말 좋네요', [])
    expect(first.needFollowup).toBe(true)

    const afterRealAnswer = runDemoAiTurn('오늘 날씨가 정말 좋네요', [
      { question: first.question!, missingField: 'offtopic_redirect', answer: '어르신이 식사를 평소보다 적게 하셨어요' },
    ])
    // 아직 시간/조치/결과를 못 물었으니 후속 질문이 이어질 수 있다 — 강제 종료로 바로 마무리한다.
    const finalized = runDemoAiTurn(
      '오늘 날씨가 정말 좋네요',
      [
        { question: first.question!, missingField: 'offtopic_redirect', answer: '어르신이 식사를 평소보다 적게 하셨어요' },
        ...(afterRealAnswer.needFollowup
          ? [{ question: afterRealAnswer.question!, missingField: afterRealAnswer.missingField!, answer: '방문 중간에' }]
          : []),
      ],
      true,
    )
    expect(finalized.report).not.toBeNull()
    expect(finalized.report!.change).not.toContain('날씨')
    expect(finalized.report!.change).toContain('식사')
  })

  it('되물은 뒤에도 다시 무관한 답만 오면 반복해서 묻지 않고, 무관한 발화를 상태로 저장하지 않는다', () => {
    const first = runDemoAiTurn('오늘 날씨가 정말 좋네요', [])
    const second = runDemoAiTurn('오늘 날씨가 정말 좋네요', [
      { question: first.question!, missingField: 'offtopic_redirect', answer: '어제 축구 경기 보셨어요?' },
    ])
    expect(second.needFollowup).toBe(false)
    expect(second.report).not.toBeNull()
    expect(second.report!.change).not.toContain('날씨')
    expect(second.report!.change).not.toContain('축구')
  })

  it('정상적인 첫 관찰 발화는 되묻지 않고 그대로 진행한다', () => {
    const result = runDemoAiTurn('물을 적게 드셨어요', [])
    expect(result.missingField).not.toBe('offtopic_redirect')
  })
})
