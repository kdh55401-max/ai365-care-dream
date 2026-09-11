import { beforeEach, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
const state = vi.hoisted(() => ({ row: {} as any, updates: 0 }))
vi.mock('./api/_lib/auth.js',()=>({requireCareSession:async()=>({participantCode:'C01'})}))
vi.mock('./api/_lib/supabase.js',()=>({getSupabaseAdmin:()=>({from:()=>{
 let patch:any=null;const filters:Record<string,unknown>={}
 const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q},maybeSingle:async()=>({data:state.row,error:null}),update:(p:any)=>{patch=p;return q},single:async()=>{if(filters.status && state.row.status!==filters.status)return {data:null,error:{code:'PGRST116'}};state.updates++;state.row={...state.row,...patch};return {data:state.row,error:null}}}
 return q
}})}))
import handler from './api/care/reports.js'
const final={change:'観察',action:'確認',result:'未確認',escalation:'確認待ち',caregiverNote:''}
beforeEach(()=>{state.row={id:'test-id',participant_code:'C01',status:'draft',started_at:new Date().toISOString()};state.updates=0})
async function submit(body:any){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
 req.method='PATCH';req.headers={}
 let data:any;const res={statusCode:200,setHeader(){},end(v:string){data=JSON.parse(v)}} as unknown as ServerResponse
 await handler(req,res);return {status:res.statusCode,data}
}
it('a lost submission response can be retried without changing timestamps or saving twice',async()=>{
 const body={id:'test-id',submit:true,caregiverFinalReport:final}
 const a=await submit(body), b=await submit(body)
 expect(a.status).toBe(200);expect(b.status).toBe(200);expect(state.updates).toBe(1)
 expect(b.data.report.submitted_at).toBe(a.data.report.submitted_at)
})
it('different content cannot overwrite a submitted report',async()=>{
 await submit({id:'test-id',submit:true,caregiverFinalReport:final})
 expect((await submit({id:'test-id',submit:true,caregiverFinalReport:{...final,result:'different'}})).status).toBe(409)
 expect(state.updates).toBe(1)
})


it('concurrent handler submissions update the isolated atomic store once and recover on retry',async()=>{
 const body={id:'test-id',submit:true,caregiverFinalReport:final}
 const results=await Promise.all([submit(body),submit(body)])
 expect(results.some(r=>r.status===200)).toBe(true)
 expect(state.updates).toBe(1)
 expect((await submit(body)).status).toBe(200)
 expect(state.updates).toBe(1)
})
