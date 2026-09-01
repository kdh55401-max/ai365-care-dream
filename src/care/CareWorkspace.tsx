import { useState } from 'react'
import WorkspaceHeader from '../roles/WorkspaceHeader'
import { CheckIcon, MicIcon, NfcIcon, PhoneIcon } from '../roles/icons'
import { useVoiceInput } from '../safetyScanner/useVoiceInput'
import { generateMockCareResponse, type CareMockResult, type CareMockRiskLevel } from './mockCareResponse'

type CareScreen = 'nfc' | 'session' | 'result' | 'saved'

const DEMO_SUBJECT_NAME = '김○○ 어르신'
const DEMO_CAUTIONS = ['최근 혈압약 복용을 시작하셨습니다.', '보행 시 지팡이 사용이 필요합니다.']
const CENTER_PHONE = import.meta.env.VITE_CENTER_PHONE_NUMBER?.trim() || undefined

const RISK_STYLES: Record<CareMockRiskLevel, { bubble: string; bar: string }> = {
  일반: { bubble: 'bg-teal-50 text-teal-800 border-teal-200', bar: 'bg-teal-500' },
  '기관 확인': { bubble: 'bg-orange-50 text-orange-800 border-orange-200', bar: 'bg-orange-500' },
  '우선 확인': { bubble: 'bg-red-50 text-red-800 border-red-200', bar: 'bg-red-600' },
}

function formatTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function CareWorkspace() {
  const [screen, setScreen] = useState<CareScreen>('nfc')
  const [visitStartedAt, setVisitStartedAt] = useState('')
  const [situation, setSituation] = useState('')
  const [result, setResult] = useState<CareMockResult | null>(null)
  const voice = useVoiceInput()

  const startNfcSimulation = () => {
    setVisitStartedAt(formatTime(new Date()))
    setScreen('session')
  }

  const handleGenerateResponse = () => {
    if (!situation.trim()) return
    setResult(generateMockCareResponse(situation.trim()))
    setScreen('result')
  }

  const handleReset = () => {
    setSituation('')
    setResult(null)
    setScreen('nfc')
  }

  const isListening = voice.voiceState === 'listening'

  return (
    <div className="relative min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8">
      <WorkspaceHeader moduleName="CARE" title="요양보호사 업무공간" />

      <main className="relative w-full max-w-md flex-1">
        {screen === 'nfc' && (
          <div className="flex flex-col items-center gap-6 pt-10 text-center">
            <div className="w-20 h-20 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center">
              <NfcIcon className="w-9 h-9" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">방문을 시작해 주세요</h2>
              <p className="text-slate-500 text-base mt-2 leading-relaxed">
                어르신 댁의 NFC 태그를 인식하면 방문이 자동으로 시작됩니다.
              </p>
            </div>
            <button
              onClick={startNfcSimulation}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4
                         hover:bg-teal-700 transition"
            >
              NFC 태그 시뮬레이션
            </button>
            <p className="text-slate-400 text-xs leading-relaxed">
              MVP 데모입니다. 실제 기기에서는 NFC 태그를 인식하면 자동으로 방문이 시작됩니다.
            </p>
          </div>
        )}

        {screen === 'session' && (
          <div className="flex flex-col gap-6 pt-4">
            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-slate-900 font-bold text-lg">{DEMO_SUBJECT_NAME}</p>
                <span className="text-xs font-bold text-teal-700 bg-teal-50 rounded-full px-2 py-0.5">
                  방문 중
                </span>
              </div>
              <p className="text-slate-400 text-sm">방문 시작 {visitStartedAt}</p>
              <div className="flex flex-col gap-1 mt-1">
                {DEMO_CAUTIONS.map((c, i) => (
                  <p key={i} className="text-slate-500 text-sm leading-relaxed">
                    · {c}
                  </p>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-6 py-4">
              <button
                onClick={() => voice.startListening((text) => setSituation(text))}
                aria-label="상황 말하기 시작"
                className="relative w-56 h-56 rounded-full text-white text-xl font-bold
                           flex flex-col items-center justify-center text-center leading-snug gap-2
                           bg-gradient-to-b from-teal-500 to-slate-900 shadow-xl
                           hover:scale-105 hover:brightness-110 active:scale-100 transition
                           focus:outline-none focus:ring-4 focus:ring-teal-300"
              >
                {isListening && (
                  <>
                    <span className="absolute -inset-2 rounded-full border-4 border-teal-300/70 animate-ping" />
                    <span
                      className="absolute -inset-6 rounded-full border-4 border-teal-200/40 animate-ping"
                      style={{ animationDelay: '0.3s' }}
                    />
                  </>
                )}
                <MicIcon className={`w-9 h-9 ${isListening ? 'animate-pulse' : ''}`} />
                {isListening ? <span>듣고 있어요</span> : (
                  <span>
                    눌러서
                    <br />
                    상황 말하기
                  </span>
                )}
              </button>

              <div className="w-full rounded-3xl bg-white border border-slate-100 shadow-sm p-4">
                <textarea
                  value={situation}
                  onChange={(e) => setSituation(e.target.value)}
                  placeholder="음성이 지원되지 않으면 여기에 상황을 직접 적어주세요."
                  rows={4}
                  className="w-full text-base text-slate-900 leading-relaxed focus:outline-none resize-none
                             placeholder:text-slate-400"
                />
              </div>

              {voice.voiceState === 'unsupported' && (
                <p className="text-slate-400 text-xs text-center">
                  이 기기에서는 음성입력을 지원하지 않아요. 텍스트로 입력해 주세요.
                </p>
              )}
              {voice.voiceError && <p className="text-red-500 text-xs text-center">{voice.voiceError}</p>}
            </div>

            <button
              onClick={handleGenerateResponse}
              disabled={!situation.trim()}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4
                         hover:bg-teal-700 transition disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              AI 대응안 만들기 (MVP 데모)
            </button>
            <button
              onClick={handleReset}
              className="text-slate-400 text-base hover:text-slate-600 transition self-center"
            >
              방문 종료
            </button>
          </div>
        )}

        {screen === 'result' && result && (
          <div className="flex flex-col gap-4 pt-4">
            {result.riskLevel === '우선 확인' && (
              <a
                href="tel:119"
                className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-3xl
                           text-xl font-bold py-4 bg-red-600 text-white shadow-lg hover:bg-red-700 transition"
              >
                <PhoneIcon className="w-6 h-6" />
                지금 119에 전화하기
              </a>
            )}

            {CENTER_PHONE && result.riskLevel !== '일반' && (
              <a
                href={`tel:${CENTER_PHONE}`}
                className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-3xl
                           text-xl font-bold py-4 bg-white text-slate-900 border-2 border-slate-900
                           hover:bg-slate-50 transition"
              >
                <PhoneIcon className="w-6 h-6" />
                센터로 전화하기
              </a>
            )}

            <div className={`rounded-3xl border px-5 py-4 text-xl font-bold ${RISK_STYLES[result.riskLevel].bubble}`}>
              <span className={`inline-block w-3 h-3 rounded-full mr-2 align-middle ${RISK_STYLES[result.riskLevel].bar}`} />
              {result.riskLevel}
            </div>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-900 text-lg mb-2">지금 할 수 있는 대응</h2>
              <p className="text-slate-700 text-lg leading-relaxed">{result.immediateAction}</p>
            </div>

            <div className="rounded-3xl bg-white border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-900 text-lg mb-2">하지 말아야 할 행동</h2>
              <p className="text-slate-700 text-lg leading-relaxed">{result.avoidAction}</p>
            </div>

            <div className="rounded-3xl bg-teal-50 border border-teal-100 p-5">
              <h2 className="font-bold text-slate-900 text-lg mb-2">센터에 전달할 내용</h2>
              <p className="text-slate-700 text-lg leading-relaxed">{result.centerReport}</p>
            </div>

            <p className="text-slate-400 text-xs text-center">
              AI 대응안은 MVP 데모 시뮬레이션입니다. 실제 판단은 현장에서 직접 하세요.
            </p>

            <div className="flex flex-col gap-3 mt-2">
              <button
                onClick={() => setScreen('saved')}
                className="w-full min-h-[52px] rounded-full bg-slate-900 text-white text-xl font-bold py-4
                           hover:bg-slate-800 transition"
              >
                기록 저장
              </button>
              <button
                onClick={() => setScreen('session')}
                className="w-full min-h-[52px] rounded-full border border-slate-300 bg-white text-slate-700
                           text-xl font-bold py-4 hover:bg-slate-50 transition"
              >
                다시 말하기
              </button>
            </div>
          </div>
        )}

        {screen === 'saved' && (
          <div className="flex flex-col items-center gap-6 pt-16 text-center">
            <div className="w-16 h-16 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center">
              <CheckIcon className="w-8 h-8" />
            </div>
            <p className="text-slate-900 text-xl font-bold leading-relaxed">
              방문 기록이 저장되었습니다.
            </p>
            <p className="text-slate-400 text-xs">MVP 데모입니다. 실제 서버에는 저장되지 않습니다.</p>
            <button
              onClick={handleReset}
              className="w-full min-h-[52px] rounded-full bg-teal-600 text-white text-xl font-bold py-4
                         hover:bg-teal-700 transition"
            >
              새로운 방문 시작
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

export default CareWorkspace
