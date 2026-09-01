import { useEffect, useRef, useState } from 'react'

export type VoiceInputState = 'idle' | 'listening' | 'unsupported'

/**
 * 기존 App.tsx의 음성입력(Web Speech API) 로직을 그대로 재사용하는 훅.
 * 음성입력이 지원되지 않거나 권한이 거부되어도 호출 측에서 텍스트입력으로
 * 대체할 수 있도록 상태와 에러만 알려주고, 화면 전환은 강제하지 않는다.
 */
export function useVoiceInput() {
  const [voiceState, setVoiceState] = useState<VoiceInputState>('idle')
  const [interimText, setInterimText] = useState('')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const finalTranscriptRef = useRef('')
  const settledRef = useRef(false)
  const onFinalRef = useRef<(text: string) => void>(() => {})

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  const isSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

  const startListening = (onFinal: (text: string) => void) => {
    setVoiceError(null)
    onFinalRef.current = onFinal

    if (voiceState === 'listening') {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setVoiceState('unsupported')
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'ko-KR'
    recognition.interimResults = true
    recognition.continuous = false
    recognitionRef.current = recognition
    finalTranscriptRef.current = ''
    settledRef.current = false
    setInterimText('')
    setVoiceState('listening')

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += transcript
        } else {
          interim += transcript
        }
      }
      setInterimText((finalTranscriptRef.current + interim).trim())
    }

    recognition.onerror = (event) => {
      if (settledRef.current) return
      settledRef.current = true
      setVoiceState('idle')
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setVoiceError('마이크 권한이 필요해요. 아래에서 직접 입력해 주세요.')
      } else if (event.error === 'no-speech') {
        setVoiceError('음성이 잘 들리지 않았어요. 다시 말씀해 주세요.')
      } else if (event.error !== 'aborted') {
        setVoiceError('음성 인식에 문제가 생겼어요. 아래에서 직접 입력해 주세요.')
      }
    }

    recognition.onend = () => {
      if (settledRef.current) return
      settledRef.current = true
      setVoiceState('idle')
      const text = finalTranscriptRef.current.trim()
      if (!text) {
        setVoiceError('음성이 잘 들리지 않았어요. 다시 말씀해 주세요.')
        return
      }
      setInterimText(text)
      onFinalRef.current(text)
    }

    try {
      recognition.start()
    } catch {
      settledRef.current = true
      setVoiceState('idle')
      setVoiceError('음성 인식을 시작하지 못했어요. 아래에서 직접 입력해 주세요.')
    }
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
  }

  return {
    voiceState,
    isSupported,
    interimText,
    voiceError,
    startListening,
    stopListening,
  }
}
