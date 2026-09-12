# METRIC_HYPOTHESES — 가설 문장 + Primary/Supporting/Guardrail 지표 분류 (초안)

**상태: 초안 — 사용자 확인 전까지 MASTER_CONTEXT.md의 확정 사업 내용으로 취급하지 않는다.**
2026-09-12, 포항 테크노파크 바이브코딩 교안 2일차(Problem→Hypothesis→Metric 루프)를
근거로 [shared/statsCalc.ts](../shared/statsCalc.ts)에 **이미 존재하는** 지표들만 재분류했다 —
새 지표를 추정해서 만들지 않았다. 지표 산식 자체는 바꾸지 않았다(정의는 statsCalc.ts가
정본).

## 0. 가설문장 (AGENTS.md §2 핵심 가치에서 도출)

| ID | 가설 |
|---|---|
| H1 | 요양보호사의 자연스러운 발화만으로 AI가 필요한 정보를 충분히 구조화할 수 있다 (추가 질문·화면 이동을 최소화하면서도). |
| H2 | "특이사항 없음"도 유효한 기록이며, AI는 실제 변화를 조용히 놓치지 않는다(거짓 정상 판정을 만들지 않는다). |
| H3 | 관리자가 이 기록을 신뢰하고 실제 검토·조치에 활용한다. |
| H4 | 요양보호사가 반복적으로 이 도구를 사용할 만큼 부담이 낮다. |

## 1. 분류 기준

- **Primary** — 위 가설을 직접 검증하는 핵심 지표. 데모데이/투자 미팅에서 "그래서 작동하는가"에
  답하는 지표.
- **Supporting** — Primary를 보조 설명하거나 진단하는 참고 지표. 나빠져도 서비스 자체가
  실패라고 단정하지는 않는다.
- **Guardrail** — 절대 넘으면 안 되는 하한선/상한선. 케어 AI가 "조용히 틀리는" 리스크를 잡는
  지표 — 이 값이 나빠지면 다른 지표가 좋아도 서비스를 멈추고 원인을 봐야 한다.

## 2. 기존 지표 재분류

### H1 — 발화만으로 충분히 구조화되는가

| 지표 (statsCalc.ts) | 분류 | 비고 |
|---|---|---|
| `quality.completionRate` (제출 완료율) | Primary | 시작한 보고가 실제로 끝까지 제출되는지. |
| `beforeAfter.completenessDelta`, `informativenessBefore/After` | Primary | AI 적용 전/후 정보충실도 차이 — H1의 핵심 증거. |
| `quality.followupOccurredRate`, `infoAddedRate` | Supporting | 추가질문·정보발견이 얼마나 일어나는지 진단용. |
| `quality.completionTime` (완료시간) | Supporting | "60초는 목표"라는 원칙과 연결되지만 그 자체로 성공/실패를 가르지 않음. |
| `quality.voiceVsText` | Supporting | 입력수단 분포 — 참고용. |

### H2 — "특이사항 없음"에서 조용히 틀리지 않는가 (가장 중요 — Guardrail 다수)

| 지표 | 분류 | 비고 |
|---|---|---|
| `noChangeFlow.noChangeToInfoFoundRate` | **Primary** | 이번 실증에서 가장 중요한 지표라고 코드 주석에도 이미 명시돼 있음 — "평소와 같음"에서 실제로 새 사실을 놓치지 않고 찾아내는지. |
| `quality.inaccuracyRate` (AI 사실오류율) | **Guardrail** | 관리자가 실제로 오류를 발견한 비율. 이게 올라가면 다른 모든 지표가 좋아도 멈춰야 한다. |
| `computeScenarioStats().fabricationCount` | **Guardrail** | 표준상황 연습에서 AI가 금지어(낙상·골절·응급실 등 실제로 없었던 사실)를 만들어냈는지 — 코드에 이미 있는 가장 직접적인 "조용히 틀림" 탐지기다. |
| `noChangeFlow.unconfirmedSeparationRate` | Supporting | 미확인 항목을 확인된 항목과 구분해서 보여줬는지 — H2를 보조 설명. |
| `noChangeFlow.repeatNoInfoParticipants` | Supporting | 3연속 무정보 보고 — 실제 관찰 누락 가능성의 조기 신호(단정 아님). |
| `quality.fallbackRate` | **Guardrail 후보** | AI가 아니라 규칙 기반 대체로 만들어진 비율. 너무 높으면 "AI가 하고 있다"는 전제 자체가 흔들림 — 하한선은 아직 미정[검증 필요]. |

### H3 — 관리자가 신뢰하고 활용하는가

| 지표 | 분류 | 비고 |
|---|---|---|
| `quality.adminEvalCompletionRate` | Primary | 관리자가 실제로 평가를 완료하는 비율. |
| `quality.aiUsefulnessAvg` | Primary | 관리자가 직접 매긴 유용성 점수. |
| `beforeAfter.rawActionable/aiActionable/actionableDeltaPp` | Supporting | AI 처리 전/후 "즉시 조치 가능" 판단 변화. |
| `beforeAfter.actualFollowupOccurred` | Supporting | 실제 조치(SMS/전화)로 이어졌는지. |

### H4 — 반복 사용 가능한 부담 수준인가

| 지표 | 분류 | 비고 |
|---|---|---|
| `participation.repeatUserRate` | Primary | 관찰 기간이 끝난 참여자 중 재사용 비율. |
| `noChangeFlow.avgNoChangeFollowupCount`, `noChangeFollowupAnswerRate` | Supporting | "평소와 비슷함" 흐름의 질문 부담. |
| `noChangeFlow.noChangeAbandonRate` | **Guardrail 후보** | "평소와 비슷함"으로 시작했다가 중도 포기하는 비율 — 하한선은 아직 미정[검증 필요]. |

## 3. 남은 결정 (사용자 확인 필요)

1. Guardrail 하한/상한 **숫자 자체**는 아직 없다(예: `inaccuracyRate`가 몇 %를 넘으면
   멈추는가). 이 문서는 "어떤 지표가 Guardrail 성격인가"만 분류했고, 임계값은 실제
   운영 데이터가 쌓이기 전에 임의로 만들지 않았다.
2. `fallbackRate`, `noChangeAbandonRate`를 Guardrail로 확정할지, Supporting으로 둘지는
   사용자 판단이 필요하다(위 표에 "Guardrail 후보"로만 표시).
3. 이 분류를 승인하면 admin 대시보드에서 Guardrail 지표를 시각적으로 구분(예: 경고
   색상)할지는 별도 UI 작업 — 이번 문서는 분류만 하고 화면 변경은 하지 않았다.

## 4. 변경 이력

- 2026-09-12: 최초 작성. 기존 `shared/statsCalc.ts`의 지표만 재분류, 신규 지표 없음.
