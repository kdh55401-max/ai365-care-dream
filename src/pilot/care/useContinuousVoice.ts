import { useEffect, useRef, useState } from 'react'

export type ContinuousVoiceState = 'idle' | 'listening' | 'reconnecting'

/** 브라우저 음성인식(Web Speech API)이 짧은 무음·네트워크 흔들림으로도 세션을
 * 끊어버리는 문제(continuous=true를 켜도 일부 브라우저/환경에서는 여전히 onend가
 * 예고 없이 온다)를 흡수하기 위한 훅. 요양보호사가 생각하거나 숨을 고르며 잠시
 * 쉬어도 입력이 사라지지 않게, 사용자가 직접 "말하기 완료"를 누르기 전까지는
 * 예기치 않은 종료를 자동으로 재연결한다.
 *
 * 재연결 자체가 불가능해 보이면(짧은 시간 안에 반복 실패) 지금까지 인식된 텍스트는
 * 보존한 채 'reconnecting' 상태로 멈추고, 호출 측이 "이어서 말하기" 버튼으로 resume()을
 * 다시 부르게 한다 — 무한 재시작으로 배터리를 태우거나 마이크를 중복 실행하지 않기
 * 위함이다. */
export function useContinuousVoice() {
  const [state, setState] = useState<ContinuousVoiceState>('idle')
  const [isListening, setIsListening] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const finalTranscriptRef = useRef('')
  // 사용자가 "말하기 완료"/취소/화면이탈로 스스로 멈춘 경우 true. true면 onend/onerror가
  // 와도 재연결을 시도하지 않는다.
  const manualStopRef = useRef(true)
  // 짧은 시간 안에 재연결이 계속 실패하는지 보려고 재시작 시각을 기록한다.
  const restartTimestampsRef = useRef<number[]>([])
  const onFinalizeRef = useRef<((text: string) => void) | null>(null)
  // 권한 대화상자가 응답 없이 멈추는 등(예: 자동화 환경, 일부 브라우저)의 상황에서
  // onstart조차 오지 않으면 무한히 "듣고 있어요" 상태에 머무를 수 있다. onstart는
  // 사용자가 말을 시작했는지와 무관하게 엔진이 실제로 듣기 시작했을 때만 오므로,
  // 이 타이머로 그 신호 자체가 오는지만 감시한다(발화 대기시간과는 별개).
  const startupWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  const clearStartupWatchdog = () => {
    if (startupWatchdogRef.current) {
      clearTimeout(startupWatchdogRef.current)
      startupWatchdogRef.current = null
    }
  }

  /** start()/재연결로 recognition.start()를 부른 직후 호출한다. 정상이라면 곧
   * onstart(또는 onresult/onerror/onend)가 와서 이 감시를 해제한다 — 8초가 지나도
   * 아무 신호가 없으면(권한 대화상자가 응답 없이 멈추는 등) 엔진이 멈춘 것으로
   * 보고 안전하게 정리한 뒤 텍스트 입력으로 대체하게 한다. */
  const armStartupWatchdog = () => {
    clearStartupWatchdog()
    startupWatchdogRef.current = setTimeout(() => {
      startupWatchdogRef.current = null
      manualStopRef.current = true
      try {
        recognitionRef.current?.abort()
      } catch {
        // 무시
      }
      recognitionRef.current = null
      setState('idle')
      setError('음성 인식을 시작하지 못했어요. 아래에 직접 입력해 주세요.')
    }, 8000)
  }

  const stopHard = () => {
    setIsListening(false)
    manualStopRef.current = true
    clearStartupWatchdog()
    try {
      recognitionRef.current?.abort()
    } catch {
      // 이미 멈춰 있어도 무시한다.
    }
    recognitionRef.current = null
  }

  useEffect(() => {
    return () => {
      // 언마운트 시 재연결 루프가 이어지지 않도록 반드시 manual로 표시하고 끊는다.
      stopHard()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function beginRecognitionInstance() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor) {
      setState('idle')
      setError('이 기기에서는 음성 입력을 지원하지 않습니다. 아래에 직접 입력해 주세요.')
      return
    }
    const recognition = new Ctor()
    recognition.lang = 'ko-KR'
    recognition.interimResults = true
    // continuous=true로 짧은 무음에는 세션을 끊지 않게 하되, 그래도 브라우저가
    // 임의로 onend를 보낼 수 있어 아래 onend 핸들러에서 재연결로 보강한다.
    recognition.continuous = true
    recognitionRef.current = recognition

    recognition.onstart = () => {
      if (manualStopRef.current || recognitionRef.current !== recognition) return
      setIsListening(true)
      clearStartupWatchdog()
    }

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return
      setIsListening(true)
      clearStartupWatchdog()
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) finalTranscriptRef.current += transcript
        else interim += transcript
      }
      setText((finalTranscriptRef.current + interim).trim())
    }

    recognition.onerror = (event) => {
      setIsListening(false)
      clearStartupWatchdog()
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        manualStopRef.current = true
        setState('idle')
        setError('마이크 권한이 필요해요. 아래에 직접 입력해 주세요.')
        return
      }
      // no-speech/network/aborted 등은 onend가 뒤이어 호출되며 그쪽에서 재연결
      // 여부를 판단한다 — 여기서 상태를 먼저 바꾸지 않는다(이중 처리 방지).
    }

    recognition.onend = () => {
      setIsListening(false)
      clearStartupWatchdog()
      if (manualStopRef.current) {
        setState('idle')
        const finalText = finalTranscriptRef.current.trim()
        setText(finalText)
        onFinalizeRef.current?.(finalText)
        return
      }

      // 사용자가 끝내지 않았는데 세션이 끊겼다 — 짧은 무음/브라우저 자동종료로 보고
      // 자동 재연결을 시도한다. 다만 최근 10초 안에 4회 넘게 반복되면(네트워크
      // 문제 등으로 재연결 자체가 반복 실패하는 상황) 무한 재시작을 멈추고
      // 사용자가 직접 재개하도록 안내한다.
      const now = Date.now()
      restartTimestampsRef.current = restartTimestampsRef.current.filter((t) => now - t < 10_000)
      restartTimestampsRef.current.push(now)
      if (restartTimestampsRef.current.length > 4) {
        setState('reconnecting')
        setError('마이크가 잠시 멈췄어요. 이어서 말씀해주세요.')
        return
      }

      try {
        beginRecognitionInstance()
        recognitionRef.current?.start()
        armStartupWatchdog()
      } catch {
        setState('reconnecting')
        setError('마이크가 잠시 멈췄어요. 이어서 말씀해주세요.')
      }
    }
  }

  /** seedText: 이미 확정된 텍스트(예: 재개 시 지금까지 인식된 내용)를 이어붙일 기준. */
  const start = (seedText = '') => {
    setIsListening(false)
    setError(null)
    finalTranscriptRef.current = seedText ? seedText.trim() + ' ' : ''
    setText(seedText.trim())
    manualStopRef.current = false
    restartTimestampsRef.current = []
    setState('listening')
    try {
      beginRecognitionInstance()
      recognitionRef.current?.start()
      armStartupWatchdog()
    } catch {
      manualStopRef.current = true
      setState('idle')
      setError('음성 인식을 시작하지 못했어요. 아래에 직접 입력해 주세요.')
    }
  }

  /** 예기치 않은 종료가 반복돼 'reconnecting'으로 멈춘 뒤, 지금까지 인식된 내용을
   * 이어서 다시 듣기 시작한다. */
  const resume = () => start(text)

  /** 사용자가 "말하기 완료"를 눌렀을 때. 마지막 인식 결과가 누락되지 않도록
   * stop()으로 정상 종료시키고(진행 중이던 final 결과를 받은 뒤 onend에서 확정),
   * onFinalize로 최종 텍스트를 전달한다. */
  const finish = (onFinalize?: (text: string) => void) => {
    onFinalizeRef.current = onFinalize ?? null
    manualStopRef.current = true
    clearStartupWatchdog()
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
        return
      } catch {
        // 이미 멈춘 상태 등 — 아래에서 즉시 확정한다.
      }
    }
    setState('idle')
    const finalText = finalTranscriptRef.current.trim()
    setText(finalText)
    onFinalize?.(finalText)
  }

  /** 취소 — 지금까지 들은 내용을 반영하지 않고 그냥 멈춘다. */
  const cancel = () => {
    stopHard()
    setState('idle')
    setError(null)
  }

  return { state, isListening, text, error, isSupported, start, resume, finish, cancel }
}
