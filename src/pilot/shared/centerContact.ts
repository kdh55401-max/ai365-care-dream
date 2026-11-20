/**
 * 가드림365재가복지센터 공개 연락처(센터 명함·지정서 기준, 2026-11-20 사용자 확인).
 * 배포 환경변수 VITE_CENTER_PHONE_NUMBER / VITE_CENTER_MOBILE_NUMBER가 있으면 그 값을 쓴다.
 */
export const CENTER_PHONE = import.meta.env.VITE_CENTER_PHONE_NUMBER?.trim() || '054-262-6303'
export const CENTER_MOBILE = import.meta.env.VITE_CENTER_MOBILE_NUMBER?.trim() || '010-2828-6303'
export const telHref = (num: string) => 'tel:' + num.replace(/[^\d+]/g, '')
