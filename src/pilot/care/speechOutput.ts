/** Web Speech Synthesis. 실제 start/end/error 이벤트로 재생 상태를 알린다. */
let speaking = false
let generation = 0
let activeUtterance: SpeechSynthesisUtterance | null = null
const listeners = new Set<() => void>()
function setSpeaking(value: boolean) {
  if (speaking === value) return
  speaking = value
  listeners.forEach((listener) => listener())
}
export const getSpeechSnapshot = () => speaking
export function subscribeSpeech(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis) && typeof SpeechSynthesisUtterance !== 'undefined'
}
export function cancelSpeech(): void {
  generation += 1
  activeUtterance = null
  setSpeaking(false)
  if (!isSpeechSynthesisSupported()) return
  try { window.speechSynthesis.cancel() } catch { /* 입력·저장 흐름은 계속할 수 있다. */ }
}
export function speakKorean(text: string, handlers?: {
  onStart?: () => void; onEnd?: () => void; onError?: (reason: string) => void
}): void {
  cancelSpeech()
  if (!isSpeechSynthesisSupported()) {
    handlers?.onError?.('speechSynthesis 미지원')
    return
  }
  if (!text.trim()) return
  const request = generation
  try {
    const utterance = new SpeechSynthesisUtterance(text.trim())
    activeUtterance = utterance
    utterance.lang = 'ko-KR'
    utterance.rate = 1
    utterance.onstart = () => {
      if (request !== generation) return
      setSpeaking(true)
      handlers?.onStart?.()
    }
    utterance.onend = () => {
      if (request !== generation) return
      activeUtterance = null
      setSpeaking(false)
      handlers?.onEnd?.()
    }
    utterance.onerror = (event) => {
      if (request !== generation) return
      activeUtterance = null
      setSpeaking(false)
      handlers?.onError?.(event.error || '음성 재생 실패')
    }
    window.speechSynthesis.speak(activeUtterance)
  } catch (error) {
    activeUtterance = null
    setSpeaking(false)
    handlers?.onError?.(error instanceof Error ? error.message : String(error))
  }
}
