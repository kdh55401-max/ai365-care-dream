import { isCenterDate } from './centerOperations.js'
export const CENTER_IMPORT_FIELDS = ['name','status','category','start','end','examination'] as const
export type CenterImportField = typeof CENTER_IMPORT_FIELDS[number]
export interface CenterImportInput { kind:'worker'|'patient'; sourceText:string; requestId:string }
export interface CenterExtraction { fields:Record<CenterImportField,string|null>; evidence:Partial<Record<CenterImportField,string>>; reasons:string[]; ambiguous:boolean }
export interface CenterImport extends CenterExtraction { id:string;status:'processing'|'saved'|'review_required'|'failed';kind:'worker'|'patient';sourceText:string;personId:string|null;createdAt:string }
export class CenterImportError extends Error { statusCode:number;constructor(statusCode:number,message:string){super(message);this.statusCode=statusCode} }
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new CenterImportError(400,'자료 형식을 확인하세요.');return value as Record<string,unknown>}
export function parseCenterImportInput(value:unknown):CenterImportInput{
 const input=object(value)
 if(Object.keys(input).some(key=>!['kind','sourceText','requestId'].includes(key))||(input.kind!=='worker'&&input.kind!=='patient')||typeof input.sourceText!=='string'||!input.sourceText.trim()||input.sourceText.length>20000||input.sourceText.includes('\u0000')||typeof input.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId))throw new CenterImportError(400,'대상 종류·원문(20,000자 이하)·요청번호를 확인하세요.')
 return {kind:input.kind,sourceText:input.sourceText,requestId:input.requestId.toLowerCase()}
}
export function validateCenterExtraction(value:unknown,sourceText:string):CenterExtraction{
 let result:Record<string,unknown>,rawFields:Record<string,unknown>,rawEvidence:Record<string,unknown>
 try{result=object(value);rawFields=object(result.fields);rawEvidence=object(result.evidence)}catch{throw new CenterImportError(502,'AI 추출 응답 형식을 확인하지 못했습니다.')}
 if(typeof result.ambiguous!=='boolean'||Object.keys(rawFields).some(k=>!CENTER_IMPORT_FIELDS.includes(k as CenterImportField)))throw new CenterImportError(502,'AI 추출 응답 필드가 올바르지 않습니다.')
 const fields={} as CenterExtraction['fields'],evidence:CenterExtraction['evidence']={},reasons:string[]=[]
 for(const key of CENTER_IMPORT_FIELDS){
  const val=rawFields[key],quote=rawEvidence[key];fields[key]=null
  if(val===null)continue
  if(typeof val!=='string'||!val.trim()||val.length>100||typeof quote!=='string'||!quote.trim()||quote.length>2000||!sourceText.includes(quote)||!quote.includes(val)){reasons.push(`${key}: 원문 근거를 확인하지 못했습니다.`);continue}
  if(['start','end','examination'].includes(key)&&!isCenterDate(val)){reasons.push(`${key}: 날짜 형식을 확인해야 합니다.`);continue}
  fields[key]=val.trim();evidence[key]=quote
 }
 const labeledNames=[...sourceText.matchAll(/(?:성명|이름)\s*[:：]\s*([^\n,;]{1,100})/g)].map(m=>m[1].trim())
 const ambiguous=result.ambiguous||new Set(labeledNames).size>1
 if(ambiguous)reasons.push('한 사람의 자료인지 확인이 필요합니다.')
 if(!fields.name)reasons.push('이름을 확인해야 합니다.')
 if(fields.start&&fields.end&&fields.start>fields.end)reasons.push('시작일과 종료일의 순서를 확인해야 합니다.')
 return {fields,evidence,reasons,ambiguous}
}
