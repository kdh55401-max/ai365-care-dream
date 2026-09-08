/** 실증 기간은 한국에서 진행되므로 "오늘"의 기준을 항상 KST(Asia/Seoul)로 고정한다.
 * 서버(Vercel 함수)의 시스템 타임존이 UTC여도 결과가 달라지지 않도록 직접 계산한다. */
export function todayKstDateString(): string {
  return kstDateString(new Date())
}

export function kstDateString(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}
