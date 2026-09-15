/** 관리자 화면(AdminApp·수급자 허브)이 함께 쓰는 작은 표시 컴포넌트. */

export function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`animate-spin ${className ?? ''}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** AI가 어르신 위험도를 판단하는 게 아니라, "Gemini 응답을 실제로 썼는지"만 보여주는
 * 기술 상태 배지. 응급신호(위험도) 배지와 절대 섞지 않는다.
 *
 * 추적 범위(중요): ai_fallback_used는 "최종 기록(구조화 보고문) 생성" 단계 하나만
 * 본다 — 추가질문 생성도 같은 Gemini 호출(runCareReportTurn)을 거치지만, 그
 * 단계는 실패해도 대체(fallback)로 조용히 넘어가는 경로 자체가 코드에 없다(성공
 * 아니면 오류를 던져 재시도 화면으로 감 — 실패한 시도는 저장되지 않는다). 그래서
 * "제출된 보고"라면 추가질문 단계들은 (재시도를 거쳤더라도) 전부 성공한 뒤에야
 * 여기 온 것이지만, 이 배지 자체는 그 사실까지 보증하지 않고 "최종 기록" 단계만
 * 말한다는 걸 라벨에 명시한다.
 * ruleBasedByDesign=true("평소와 비슷했어요" 흐름)면 애초에 Gemini를 부르지 않는
 * 설계이므로, "추적 안 됨(확인 불가)"과 구분해 "AI 미호출(규칙 기반)"로 보여준다. */
export function FallbackBadge({ used, ruleBasedByDesign }: { used: boolean | null | undefined; ruleBasedByDesign?: boolean }) {
  if (ruleBasedByDesign) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">전체: AI 미호출(규칙 기반)</span>
  }
  if (used === null || used === undefined) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">최종 기록: AI 처리상태 확인 불가</span>
  }
  if (used) {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">최종 기록: AI 대체 처리됨</span>
  }
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 text-slate-400">최종 기록: AI 처리 성공</span>
}
