/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string
  /** 기관 대표 전화번호. 미설정 시 "센터로 전화하기" 버튼은 표시되지 않는다. */
  readonly VITE_CENTER_PHONE_NUMBER?: string
  /** Google Analytics 4 측정 ID(G-XXXXXXXXXX). 미설정 시 분석 코드가 로드되지 않는다. */
  readonly VITE_GA_MEASUREMENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
