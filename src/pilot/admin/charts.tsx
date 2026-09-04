import type { Fraction } from '../../../shared/statsCalc'
import type { CumulativePoint } from '../shared/adminRepo'

const W = 640
const H = 260
const PAD = { top: 24, right: 16, bottom: 36, left: 36 }

export interface BeforeAfterMetric {
  label: string
  before: Fraction | number | null
  after: Fraction | number | null
  afterOnly?: boolean
  maxValue?: number // 기본 100(%). 정보충실도처럼 0~4 스케일이면 4를 넘긴다.
}

function pct(v: Fraction | number | null, maxValue: number): number | null {
  if (v === null) return null
  if (typeof v === 'number') return (v / maxValue) * 100
  return v.percent === null ? null : v.percent
}

function fmtValue(v: Fraction | number | null): string {
  if (v === null) return '—'
  if (typeof v === 'number') return String(v)
  return v.percent === null ? '평가 전' : `${v.percent}%`
}

function fmtSub(v: Fraction | number | null): string {
  if (v === null || typeof v === 'number') return ''
  if (v.denominator === 0) return ''
  return `${v.numerator}/${v.denominator}건`
}

/** 라이브러리 없이 순수 SVG로 그리는 전후 비교 그룹 막대그래프. */
export function BeforeAfterBarChart({ metrics }: { metrics: BeforeAfterMetric[] }) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const groupW = plotW / metrics.length
  const barW = Math.min(48, groupW / 3)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="AI 적용 전후 보고품질 비교">
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke="#e2e8f0" />
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#e2e8f0" />
      {metrics.map((m, i) => {
        const maxValue = m.maxValue ?? 100
        const beforePct = pct(m.before, maxValue)
        const afterPct = pct(m.after, maxValue)
        const cx = PAD.left + groupW * i + groupW / 2
        const beforeH = beforePct === null ? 0 : (beforePct / 100) * plotH
        const afterH = afterPct === null ? 0 : (afterPct / 100) * plotH
        const beforeX = cx - barW - 4
        const afterX = cx + 4
        const delta =
          typeof m.before !== 'number' && typeof m.after !== 'number' && m.before && m.after && m.before.percent !== null && m.after.percent !== null
            ? Math.round((m.after.percent - m.before.percent) * 10) / 10
            : null
        return (
          <g key={m.label}>
            {!m.afterOnly && (
              <>
                <rect x={beforeX} y={H - PAD.bottom - beforeH} width={barW} height={beforeH} fill="#cbd5e1" rx={4} />
                <text x={beforeX + barW / 2} y={H - PAD.bottom - beforeH - 6} textAnchor="middle" fontSize="11" fill="#475569">
                  {fmtValue(m.before)}
                </text>
              </>
            )}
            <rect x={afterX} y={H - PAD.bottom - afterH} width={barW} height={afterH} fill="#0d9488" rx={4} />
            <text x={afterX + barW / 2} y={H - PAD.bottom - afterH - 6} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#0f766e">
              {fmtValue(m.after)}
            </text>
            <text x={cx} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="11" fill="#334155">
              {m.label}
            </text>
            <text x={cx} y={H - PAD.bottom + 30} textAnchor="middle" fontSize="9" fill="#94a3b8">
              {fmtSub(m.after)}
            </text>
            {delta !== null && (
              <text x={cx} y={PAD.top - 8} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#1e293b">
                {delta > 0 ? '+' : ''}
                {delta}%p
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** 일자별 누적 제출 건수 선 그래프. 미래 날짜에는 절대 값을 그리지 않는다. */
export function CumulativeLineChart({ series, goal }: { series: CumulativePoint[]; goal: number }) {
  if (series.length === 0) return null
  const known = series.filter((p) => !p.isFuture)
  const maxY = Math.max(goal, ...known.map((p) => p.totalCumulative), 1)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const xStep = plotW / Math.max(1, series.length - 1)
  const xOf = (i: number) => PAD.left + xStep * i
  const yOf = (v: number) => H - PAD.bottom - (v / maxY) * plotH

  const linePoints = known.map((p, i) => `${xOf(i)},${yOf(p.totalCumulative)}`).join(' ')
  const goalY = yOf(goal)
  const todayIndex = series.findIndex((p) => p.isToday)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="일자별 누적 돌봄보고">
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke="#e2e8f0" />
      <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="#e2e8f0" />
      <line x1={PAD.left} y1={goalY} x2={W - PAD.right} y2={goalY} stroke="#94a3b8" strokeDasharray="4 4" />
      <text x={W - PAD.right} y={goalY - 4} textAnchor="end" fontSize="10" fill="#64748b">
        목표 {goal}건
      </text>
      {known.length > 1 && <polyline points={linePoints} fill="none" stroke="#0d9488" strokeWidth={2.5} />}
      {known.map((p, i) => (
        <circle key={p.date} cx={xOf(i)} cy={yOf(p.totalCumulative)} r={2.5} fill="#0d9488" />
      ))}
      {todayIndex >= 0 && (
        <line x1={xOf(todayIndex)} y1={PAD.top} x2={xOf(todayIndex)} y2={H - PAD.bottom} stroke="#f59e0b" strokeDasharray="2 3" />
      )}
      {series.map((p, i) =>
        i % 2 === 0 ? (
          <text key={p.date} x={xOf(i)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {p.date.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  )
}
