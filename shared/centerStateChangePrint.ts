import { STATE_CHANGE_CHECKS, type StateChangeRecord } from './centerStateChange.js'

export interface StateChangePrintHeader { centerName: string; patientName: string; grade: string; period: string; draft: boolean; preview?: boolean }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const multiline = (s: string) => esc(s).replace(/\n/g, '<br>')

/** 실제 서식(월 1부 · 1~5주차 표 · 기타 사항 · 서명란)과 같은 배치의 A4 인쇄용 HTML 문서. */
export function stateChangePrintHtml(record: StateChangeRecord, h: StateChangePrintHeader): string {
  const [year, month] = h.period.split('-')
  const rows = record.weeks.map((w, i) => {
    const date = w.date ? `${Number(w.date.slice(5, 7))}/${Number(w.date.slice(8, 10))}` : ''
    const checks = STATE_CHANGE_CHECKS.map(c => `${w.checks[c.key] ? '☑' : '□'}${esc(c.label)}`).join(' ')
    return `<tr><td class="c">${i + 1}</td><td class="c">${date}</td><td class="chk">${checks}</td><td>${multiline(w.remarks)}</td><td>${multiline(w.result)}</td><td class="sig"></td></tr>`
  }).join('')
  const hints = STATE_CHANGE_CHECKS.map(c => `<b>${esc(c.label)}</b>: ${esc(c.hint)}`).join('<br>')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(`${year}년 ${Number(month)}월 상태변화 기록지 ${h.patientName}`)}</title>
<style>
@page { size: A4; margin: 10mm 10mm }
body { font: 9.5pt/1.35 'Malgun Gothic', 'Noto Sans KR', sans-serif; color: #000 }
h1 { text-align: center; font-size: 16pt; margin: 0 0 6px }
table { width: 100%; border-collapse: collapse; margin-bottom: 5px; page-break-inside: avoid }
th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: top }
th { background: #eee; font-weight: 600 }
.c { text-align: center; width: 6% } .chk { width: 21%; font-size: 9.5pt } .sig { width: 11% }
.main td { height: 30mm }
.note { font-size: 8.5pt; margin: 3px 0 }
.hint { font-size: 8.5pt }
.mark { text-align: right; font-size: 9pt }
</style></head><body>
${h.preview ? '<p class="mark">가상자료 시연 · 실제 기관 기록 아님</p>' : ''}
${h.draft ? '<p class="mark">초안 · 확정 전 출력물</p>' : ''}
<h1>( ${esc(year)} )년 ( ${Number(month)} )월 상태변화 기록지</h1>
<table><tr><th>수급자명</th><td>${esc(h.patientName)}</td><th>기관</th><td>${esc(h.centerName)}</td><th>등급</th><td>${esc(h.grade)}</td></tr>
<tr><th>요양보호사</th><td colspan="2">(인)</td><th>사회복지사</th><td colspan="2">(인)</td></tr></table>
<table class="main"><thead><tr><th>주차</th><th>서비스 일자</th><th>상태변화 체크</th><th>특이사항 및 조치내용</th><th>급여제공결과</th><th>급여제공자 서명</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">※ 담당 요양보호사는 주1회 이상 수급자의 상태변화, 특이사항, 급여제공 결과 등을 자세히 기록합니다.</p>
<table><tr><th style="width:14%">기타 사항</th><td style="height:14mm">${multiline(record.etc)}</td></tr></table>
<p class="note">※ 상태변화 체크 시 해당되는 내용을 참고하시어 기록합니다.</p>
<table><tr><td class="hint">${hints}</td></tr></table>
</body></html>`
}
