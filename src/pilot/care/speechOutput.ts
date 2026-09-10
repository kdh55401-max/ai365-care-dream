/** 브라우저 표준 Web Speech Synthesis API(질문 음성 출력·요약 낭독)를 감싼 최소
 * 래퍼. 새 모델/공급자를 추가하지 않는다 — `useContinuousVoice.ts`가 이미 쓰는
 * Web Speech API의 "출력" 쪽(SpeechSynthesis)만 사용한다. 이 API 자체가 브라우저·
 * 운영체제마다 실제 한국어 음성이 설치돼 있는지가 다르므로, 호출은 항상 실패해도
 * 안전하게(예외를 던지지 않고 조용히 무시) 동작해야 한다 — 이 기능이 없다고 대화
 * 흐름 자체가 막히면 안 된다. */

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** 텍스트를 한국어로 읽는다. onStart/onEnd는 실제로 발화가 시작·종료됐을 때만
 * 불린다 — 지원하지 않는 환경이거나 호출 자체가 실패하면 onError만 불리고
 * onStart는 불리지 않는다(호출부가 "말하는 중"으로 착각해 아바타를 잘못된
 * 상태로 표시하지 않게 하기 위함). */
export function speakKorean(
  text: string,
  handlers?: { onStart?: () => void; onEnd?: () => void; onError?: (reason: string) => void },
): void {
  if (!isSpeechSynthesisSupported()) {
    handlers?.onError?.('speechSynthesis 미지원')
    return
  }
  const trimmed = text.trim()
  if (!trimmed) return
  try {
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.lang = 'ko-KR'
    utterance.rate = 1
    utterance.onstart = () => handlers?.onStart?.()
    utterance.onend = () => handlers?.onEnd?.()
    utterance.onerror = (e) => handlers?.onError?.(e.error || '알 수 없는 오류')
    // 현재 화면의 최신 요청만 읽는다. 요약 연속 클릭도 대기열에 쌓지 않는다.
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  } catch (e) {
    handlers?.onError?.(e instanceof Error ? e.message : String(e))
  }
}

export function cancelSpeech(): void {
  if (!isSpeechSynthesisSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // 무시 — 낭독을 못 멈춰도 화면 흐름을 막지 않는다.
  }
}
