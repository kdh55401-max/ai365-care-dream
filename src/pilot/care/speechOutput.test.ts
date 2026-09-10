import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelSpeech, getSpeechSnapshot, speakKorean, subscribeSpeech } from './speechOutput'
class Utterance {
  lang = ''; rate = 1
  onstart?: () => void
  onend?: () => void
  onerror?: (event: { error: string }) => void
  text: string
  constructor(text: string) { this.text = text }
}
function install() {
  const queued: Utterance[] = []
  const synthesis = { speak: vi.fn((u: Utterance) => queued.push(u)), cancel: vi.fn() }
  vi.stubGlobal('window', { speechSynthesis: synthesis })
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  return { queued, synthesis }
}
afterEach(() => { cancelSpeech(); vi.unstubAllGlobals() })
describe('speech output lifecycle', () => {
  it('reports speaking only between actual start and end events', () => {
    const { queued } = install()
    const listener = vi.fn(); const unsubscribe = subscribeSpeech(listener)
    speakKorean('오늘 어떠셨어요?'); expect(getSpeechSnapshot()).toBe(false)
    queued[0].onstart?.(); expect(getSpeechSnapshot()).toBe(true)
    queued[0].onend?.(); expect(getSpeechSnapshot()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2); unsubscribe()
  })
  it('ignores delayed events from superseded or cancelled utterances', () => {
    const { queued, synthesis } = install()
    speakKorean('첫 질문'); queued[0].onstart?.()
    speakKorean('다음 질문'); queued[1].onstart?.()
    queued[0].onend?.(); expect(getSpeechSnapshot()).toBe(true)
    cancelSpeech(); queued[1].onstart?.(); expect(getSpeechSnapshot()).toBe(false)
    expect(synthesis.cancel).toHaveBeenCalledTimes(3)
  })
  it('does not mark failed or unsupported requests as speaking', () => {
    const { synthesis } = install(); const onError = vi.fn()
    synthesis.speak.mockImplementation(() => { throw Error('blocked') })
    expect(() => speakKorean('안내', { onError })).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1); expect(getSpeechSnapshot()).toBe(false)
    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    speakKorean('안내', { onError }); expect(onError).toHaveBeenCalledTimes(2)
  })
  it('errors end the actual speaking state', () => {
    const { queued } = install(); const onError = vi.fn()
    speakKorean('안내', { onError }); queued[0].onstart?.()
    queued[0].onerror?.({ error: 'audio-busy' })
    expect(onError).toHaveBeenCalledWith('audio-busy'); expect(getSpeechSnapshot()).toBe(false)
  })
})
