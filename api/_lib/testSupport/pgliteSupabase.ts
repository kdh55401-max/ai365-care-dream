import { PGlite, types } from '@electric-sql/pglite'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 테스트 전용: 실제 Postgres 엔진(PGlite) 위에 supabase-js 질의 빌더의 필요한 부분(select·eq·in·is·gte·order·limit·range·
 * insert·update·maybeSingle·single·rpc)만 흉내 낸다. 서버 핸들러(api/…)를 수정 없이 실제 SQL·실제 DB 함수와 함께 돌려
 * 권한 검사와 저장 결과를 검증하기 위한 것이며 운영 코드가 아니다. */

export function newTestDb(): PGlite {
  // timestamptz를 문자열 그대로(마이크로초 유지) 돌려준다 — 운영 PostgREST와 같게 수정 충돌 검사 값이 되돌려 보내진다.
  return new PGlite({ parsers: { [types.TIMESTAMPTZ]: (v: string) => v } })
}

type Where = { col: string; op: string; val?: unknown }
interface Result {
  data: unknown
  error: { message: string; code?: string } | null
}

const IDENT = /^[a-z_][a-z0-9_]*$/

class Query implements PromiseLike<Result> {
  private cols = '*'
  private wheres: Where[] = []
  private orders: string[] = []
  private limitN: number | null = null
  private rangeN: [number, number] | null = null
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: Record<string, unknown> = {}
  private mode: 'many' | 'maybe' | 'one' = 'many'

  private db: PGlite
  private table: string

  constructor(db: PGlite, table: string) {
    this.db = db
    this.table = table
    if (!IDENT.test(table)) throw new Error(`bad table ${table}`)
  }

  select(cols = '*') {
    this.cols = cols
    return this
  }
  insert(row: Record<string, unknown>) {
    this.op = 'insert'
    this.payload = row
    return this
  }
  update(row: Record<string, unknown>) {
    this.op = 'update'
    this.payload = row
    return this
  }
  eq(col: string, val: unknown) {
    this.wheres.push({ col, op: '=', val })
    return this
  }
  in(col: string, val: unknown[]) {
    this.wheres.push({ col, op: 'in', val })
    return this
  }
  gte(col: string, val: unknown) {
    this.wheres.push({ col, op: '>=', val })
    return this
  }
  is(col: string, val: null) {
    this.wheres.push({ col, op: 'is', val })
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push(`${col} ${opts?.ascending === false ? 'desc' : 'asc'}`)
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  range(from: number, to: number) {
    this.rangeN = [from, to]
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }
  single() {
    this.mode = 'one'
    return this
  }

  private async run(): Promise<Result> {
    try {
      const params: unknown[] = []
      const p = (v: unknown) => {
        params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v)
        return `$${params.length}`
      }
      const cols = this.cols.split(',').map((c) => c.trim())
      for (const c of cols) if (c !== '*' && !IDENT.test(c)) throw new Error(`bad column ${c}`)
      const where = this.wheres
        .map((w) => {
          if (!IDENT.test(w.col)) throw new Error(`bad column ${w.col}`)
          if (w.op === 'is') return `${w.col} is null`
          if (w.op === 'in') {
            params.push(w.val)
            return `${w.col} = any($${params.length}::text[])`
          }
          return `${w.col} ${w.op} ${p(w.val)}`
        })
        .join(' and ')
      const whereSql = where ? ` where ${where}` : ''
      let sql: string
      if (this.op === 'insert') {
        const keys = Object.keys(this.payload)
        for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad column ${k}`)
        sql = `insert into ${this.table} (${keys.join(', ')}) values (${keys.map((k) => p(this.payload[k])).join(', ')}) returning ${this.cols}`
      } else if (this.op === 'update') {
        const keys = Object.keys(this.payload)
        for (const k of keys) if (!IDENT.test(k)) throw new Error(`bad column ${k}`)
        sql = `update ${this.table} set ${keys.map((k) => `${k} = ${p(this.payload[k])}`).join(', ')}${whereSql} returning ${this.cols}`
      } else {
        sql = `select ${this.cols} from ${this.table}${whereSql}`
        if (this.orders.length) sql += ` order by ${this.orders.join(', ')}`
        if (this.rangeN) sql += ` limit ${this.rangeN[1] - this.rangeN[0] + 1} offset ${this.rangeN[0]}`
        else if (this.limitN !== null) sql += ` limit ${this.limitN}`
      }
      const rows = (await this.db.query(sql, params)).rows as unknown[]
      if (this.mode === 'maybe') {
        if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } }
        return { data: rows[0] ?? null, error: null }
      }
      if (this.mode === 'one') {
        if (rows.length !== 1) return { data: null, error: { message: 'expected one row' } }
        return { data: rows[0], error: null }
      }
      return { data: rows, error: null }
    } catch (e) {
      const err = e as { message?: string; code?: string }
      return { data: null, error: { message: err.message ?? 'error', code: err.code } }
    }
  }

  then<R1 = Result, R2 = never>(onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected)
  }
}

export function pgliteSupabase(db: PGlite) {
  return {
    from: (table: string) => new Query(db, table),
    async rpc(fn: string, args: { p: unknown }): Promise<Result> {
      if (!IDENT.test(fn)) throw new Error(`bad function ${fn}`)
      try {
        const r = await db.query<{ r: unknown }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(args.p)])
        return { data: r.rows[0].r, error: null }
      } catch (e) {
        const err = e as { message?: string; code?: string }
        return { data: null, error: { message: err.message ?? 'error', code: err.code } }
      }
    },
  }
}

/** 핸들러 호출용 요청·응답. */
export function fakeRequest(method: string, url: string, cookie?: string, body?: unknown): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  Object.assign(stream, { method, url, headers: cookie ? { cookie } : {} })
  return stream
}

export function fakeResponse() {
  const headers: Record<string, string> = {}
  const out = { statusCode: 200, body: '' as string, headers }
  const res = {
    get statusCode() {
      return out.statusCode
    },
    set statusCode(v: number) {
      out.statusCode = v
    },
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v
    },
    end: (chunk?: string) => {
      out.body = chunk ?? ''
    },
  } as unknown as ServerResponse
  return {
    res,
    get status() {
      return out.statusCode
    },
    get json(): Record<string, unknown> {
      return out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {}
    },
    headers,
  }
}
