import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

// 테이블이 4개뿐인 소규모 실증이라 Supabase 코드젠(Database 타입) 없이 사용한다.
// 그 결과 select()/insert() 결과가 타입 추론되지 않으므로, 반환 타입을 의도적으로
// any로 열어 두고 각 호출부에서 우리가 정의한 인터페이스로 캐스팅해 사용한다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null

/** 서버(API 함수)에서만 사용하는 Service Role 클라이언트. RLS를 우회하므로
 * 절대 브라우저로 전달하거나 클라이언트 코드에서 import하지 않는다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): any {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  }
  return client
}
