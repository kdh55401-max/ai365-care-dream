import type {IncomingMessage,ServerResponse} from 'node:http'
import {CenterImportError,parseCenterImportInput} from '../../../shared/centerImport.js'
import {centerSession} from '../centerAuth.js'
import {assertCenterOrganizationReady} from '../centerDocumentStore.js'
import {listCenterImports,runCenterImport} from '../centerPersonImport.js'
import {ApiError,readJsonBody,requireMethod,sendJson,withHandler} from '../http.js'
import {getSupabaseAdmin} from '../supabase.js'
export default async function handler(req:IncomingMessage,res:ServerResponse){await withHandler(res,async()=>{
 requireMethod(req,'GET','POST');const actor=await centerSession(req)
 if(!actor||actor.status!=='active'||!['admin','master'].includes(actor.role))throw new ApiError(403,'승인된 기관 관리자만 인물 자료를 처리할 수 있습니다.')
 if(req.method==='POST'&&req.headers['sec-fetch-site']&&!['same-origin','none'].includes(String(req.headers['sec-fetch-site'])))throw new ApiError(403,'동일 출처에서 요청하세요.')
 let db:ReturnType<typeof getSupabaseAdmin>;try{db=getSupabaseAdmin()}catch{throw new ApiError(503,'기관 자료 저장소 설정이 필요합니다.')}
 await assertCenterOrganizationReady(db,actor.organization_code)
 if(req.method==='GET'){sendJson(res,200,{imports:await listCenterImports(db,actor.organization_code)});return}
 try{const input=parseCenterImportInput(await readJsonBody(req));sendJson(res,200,{import:await runCenterImport(db,actor.organization_code,actor.id,input)})}
 catch(error){if(error instanceof CenterImportError)throw new ApiError(error.statusCode,error.message);throw error}
})}
