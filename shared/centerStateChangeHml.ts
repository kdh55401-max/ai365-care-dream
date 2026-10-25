import { STATE_CHANGE_CHECKS, type StateChangeRecord } from './centerStateChange.js'
import type { StateChangePrintHeader } from './centerStateChangePrint.js'
import { HML_COLDEF, HML_SECDEF, HML_STYLE_HEAD } from './centerStateChangeHmlStyle.js'

// 서식 정의 번호(HML_STYLE_HEAD 안): 표 테두리 3, 제목칸 9(음영)·본문칸 10, 글자 11(제목)·12(작은 글)·13(작은 굵은 글)·14(굵은 글)·15(보통), 문단 1(가운데)·5(양쪽)·19(가운데 촘촘). 아래 extendHead가 덧붙이는 번호: 글자 20(작은 굵은 글+음영), 문단 20(아래 점선), 테두리 16(아래 점선)
export type StateChangeOrientation = 'portrait' | 'landscape'
// 열: 주차·서비스 일자·체크·특이사항·급여제공결과·급여제공자 서명. 합계 = 용지 너비 − 좌우 여백(2835×2)
const LAYOUTS = {
  portrait: { widths: [2400, 3600, 9000, 16800, 13400, 8559], weekHeight: 10000 },
  landscape: { widths: [2000, 3000, 9000, 31000, 23000, 10518], weekHeight: 7000 },
}
const xml = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

interface Run { text: string; strong?: boolean }
interface Cell { col: number; span?: number; text?: string; lines?: string[]; runs?: Run[][]; ruled?: number; head?: boolean; align?: 'center' | 'left'; bold?: boolean; small?: boolean }
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const LINE = 1440 // 9pt 글자·줄간격 160%의 한 줄 높이(한글 단위)

/** 손글씨용 줄선·체크 강조에 쓰는 정의(글자 20, 문단 20, 테두리 16)를 기존 서식 정의에 덧붙인다. */
function extendHead(head: string) {
  const pick = (tag: string, id: number) => head.match(new RegExp(`<${tag} [^>]*Id="${id}"[\\s\\S]*?</${tag}>`))![0]
  const add = (list: string, item: string) => head
    .replace(new RegExp(`<${list} Count="(\\d+)">`), (_m, n) => `<${list} Count="${Number(n) + 1}">`)
    .replace(`</${list}>`, `${item}</${list}>`)
  head = add('CHARSHAPELIST', pick('CHARSHAPE', 13).replace('Id="13"', 'Id="20"').replace('ShadeColor="4294967295"', 'ShadeColor="14277081"'))
  head = add('BORDERFILLLIST', pick('BORDERFILL', 1).replace('Id="1"', 'Id="16"').replace('<BOTTOMBORDER Type="None"', '<BOTTOMBORDER Type="Dot"'))
  head = add('PARASHAPELIST', pick('PARASHAPE', 5).replace('Id="5"', 'Id="20"').replace('<PARABORDER BorderFill="5"', '<PARABORDER BorderFill="16"'))
  return head
}

function paragraphs(lines: string[], cell: Cell) {
  const para = cell.align === 'center' ? 1 : 5
  const shape = cell.small ? (cell.bold ? 13 : 12) : (cell.head || cell.bold ? 14 : 15)
  if (cell.runs) return cell.runs.map(line => `<P ParaShape="${para}" Style="0">${line.map(run => `<TEXT CharShape="${run.strong ? 20 : shape}"><CHAR>${xml(run.text)}</CHAR></TEXT>`).join('')}</P>`).join('')
  if (cell.ruled && lines.every(line => !line)) return `<P ParaShape="20" Style="0"><TEXT CharShape="${shape}"/></P>`.repeat(cell.ruled)
  return lines.map(line => line ? `<P ParaShape="${para}" Style="0"><TEXT CharShape="${shape}"><CHAR>${xml(line)}</CHAR></TEXT></P>` : `<P ParaShape="${para}" Style="0"><TEXT CharShape="${shape}"/></P>`).join('')
}
function makeRow(widths: number[]) {
  return (rowAddr: number, height: number, cells: Cell[]) => `<ROW>${cells.map(c => {
    const span = c.span ?? 1
    const width = widths.slice(c.col, c.col + span).reduce((a, b) => a + b, 0)
    const lines = c.lines ?? (c.text ?? '').split('\n')
    return `<CELL BorderFill="${c.head ? 9 : 10}" ColAddr="${c.col}" ColSpan="${span}" Dirty="false" Editable="false" HasMargin="true" Header="false" Height="${height}" Protect="false" RowAddr="${rowAddr}" RowSpan="1" Width="${width}"><CELLMARGIN Bottom="283" Left="283" Right="283" Top="283"/><PARALIST LineWrap="Break" LinkListID="0" LinkListIDNext="0" TextDirection="0" VertAlign="${c.align === 'center' ? 'Center' : 'Top'}">${paragraphs(lines, c)}</PARALIST></CELL>`
  }).join('')}</ROW>`
}

/** 기관 자체 서식(월 1부 · 1~5주차 · 체크 6항목 · 특이사항 · 급여제공결과 · 기타사항)을 한글에서 바로 열어 고칠 수 있는 .hml 문서로 만든다. 한 달이 A4 한 면에 들어가게 세로·가로 두 배치를 둔다. */
export function stateChangeHml(record: StateChangeRecord, h: StateChangePrintHeader, orientation: StateChangeOrientation = 'portrait'): string {
  const { widths, weekHeight } = LAYOUTS[orientation]
  const total = widths.reduce((a, b) => a + b, 0)
  const row = makeRow(widths)
  const [year, month] = h.period.split('-')
  const title = `( ${year} )년 ( ${Number(month)} )월 상태변화 기록지`
  const rows: string[] = []
  const heights: number[] = []
  const add = (height: number, cells: Cell[]) => { rows.push(row(rows.length, height, cells)); heights.push(height) }
  const center = (text: string, col: number, span = 1, head = false): Cell => ({ col, span, text, head, align: 'center' })
  if (orientation === 'landscape') {
    add(2000, [center('수급자명', 0, 2, true), { ...center(h.patientName, 2), bold: true }, center(`기관: ${h.centerName}      등급: ${h.grade}`, 3), center('요양보호사 (인)      사회복지사 (인)', 4, 2)])
  } else {
    add(2200, [center('수급자명', 0, 1, true), { ...center(h.patientName, 1, 2), bold: true }, center('기관', 3, 1, true), center(h.centerName, 4, 2)])
    add(2200, [center('등급', 0, 1, true), center(h.grade, 1, 2), center('요양보호사 (인)', 3), center('사회복지사 (인)', 4, 2)])
  }
  add(1800, ['주차', '서비스 일자', '상태변화 체크', '특이사항 및 조치내용', '급여제공결과', '급여제공자 서명'].map((text, col) => center(text, col, 1, true)))
  record.weeks.forEach((w, i) => {
    const date = w.date ? [`${Number(w.date.slice(5, 7))}/${Number(w.date.slice(8, 10))}`, `(${WEEKDAYS[new Date(Date.UTC(Number(w.date.slice(0, 4)), Number(w.date.slice(5, 7)) - 1, Number(w.date.slice(8, 10)))).getUTCDay()]})`] : []
    const mark = (key: typeof STATE_CHANGE_CHECKS[number]['key']): Run => ({ text: `${w.checks[key] ? '☑' : '□'}${STATE_CHANGE_CHECKS.find(c => c.key === key)!.label}`, strong: w.checks[key] })
    const gap: Run = { text: ' ' }
    const checks = [[mark('body'), gap, mark('cognition'), gap, mark('emotion')], [mark('nutrition')], [mark('rehab'), gap, mark('safety')]] // 한 칸에 3줄, 체크한 항목은 굵게+음영
    const ruled = Math.floor((weekHeight - 566) / LINE)
    add(weekHeight, [{ ...center(String(i + 1), 0), bold: true }, { col: 1, lines: date, align: 'center' }, { col: 2, runs: checks, small: true }, { col: 3, text: w.remarks, small: true, ruled }, { col: 4, text: w.result, small: true, ruled }, { col: 5, text: '' }])
  })
  const hints = STATE_CHANGE_CHECKS.map(c => `${c.label}: ${c.hint}`)
  add(1400, [{ col: 0, span: 6, text: '※ 담당 요양보호사는 주1회 이상 수급자의 상태변화, 특이사항, 급여제공 결과 등을 자세히 기록합니다.', small: true }])
  add(orientation === 'landscape' ? 2500 : 3000, [center('기타 사항', 0, 1, true), { col: 1, span: 5, text: record.etc }])
  add(1400, [{ col: 0, span: 6, text: '※ 상태변화 체크 시 해당되는 내용을 참고하시어 기록합니다.', small: true }])
  add(1400, [{ col: 0, span: 6, lines: orientation === 'landscape' ? [hints.slice(0, 2).join('   '), hints.slice(2, 4).join('   '), hints.slice(4).join('   ')] : hints, small: true }])
  const height = heights.reduce((a, b) => a + b, 0)

  const head = extendHead(HML_STYLE_HEAD).replace(/<CARETPOS[^>]*\/>/, '<CARETPOS List="0" Para="0" Pos="0"/>')
  const marks = [h.preview ? '가상자료 시연 · 실제 기관 기록 아님' : '', h.draft ? '초안 · 확정 전 출력물' : ''].filter(Boolean).map(text => `<P ParaShape="5" Style="0"><TEXT CharShape="15"><CHAR>${xml(text)}</CHAR></TEXT></P>`).join('')
  const table = `<TABLE BorderFill="3" CellSpacing="0" ColCount="${widths.length}" PageBreak="Cell" RepeatHeader="false" RowCount="${rows.length}"><SHAPEOBJECT InstId="1227200301" Lock="false" NumberingType="Table" TextWrap="TopAndBottom" ZOrder="0"><SIZE Height="${height}" HeightRelTo="Absolute" Protect="false" Width="${total}" WidthRelTo="Absolute"/><POSITION AffectLSpacing="false" AllowOverlap="false" FlowWithText="true" HoldAnchorAndSO="false" HorzAlign="Left" HorzOffset="0" HorzRelTo="Para" TreatAsChar="true" VertAlign="Top" VertOffset="0" VertRelTo="Para"/><OUTSIDEMARGIN Bottom="0" Left="0" Right="0" Top="0"/></SHAPEOBJECT><INSIDEMARGIN Bottom="283" Left="283" Right="283" Top="283"/>${rows.join('')}</TABLE>`
  // 머리말·꼬리말 칸은 쓰지 않으므로 0으로 두어 본문 공간을 넓힌다. 가로는 용지 방향만 바꾼다(용지 크기 수치는 세로 기준 그대로).
  const secdef = HML_SECDEF.replace('Footer="2835"', 'Footer="0"').replace('Header="2835"', 'Header="0"').replace('Landscape="0"', orientation === 'landscape' ? 'Landscape="1"' : 'Landscape="0"')
  return `﻿<?xml version="1.0" encoding="UTF-8" standalone="no" ?><HWPML Style="embed" SubVersion="10.0.0.0" Version="2.91"><HEAD SecCnt="1"><DOCSUMMARY><TITLE>${xml(title)}</TITLE><AUTHOR>AI365 CARE DREAM</AUTHOR></DOCSUMMARY>${head}</HEAD><BODY><SECTION Id="0"><P ColumnBreak="false" PageBreak="false" ParaShape="1" Style="0"><TEXT CharShape="11">${secdef}${HML_COLDEF}<CHAR>${xml(title)}</CHAR></TEXT></P>${marks}<P ColumnBreak="false" PageBreak="false" ParaShape="2" Style="0"><TEXT CharShape="1">${table}<CHAR/></TEXT></P></SECTION></BODY><TAIL/></HWPML>`
}
