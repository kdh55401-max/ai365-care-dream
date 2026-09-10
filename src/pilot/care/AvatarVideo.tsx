import { useEffect, useRef, useState } from 'react'

// Silent generated animation; voice playback remains managed by CareApp.
export function AvatarVideo({ home }: { home: boolean }) {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [greeted, setGreeted] = useState(!home)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState<'welcome' | 'idle' | null>(null)
  const welcome = useRef<HTMLVideoElement>(null)
  const idle = useRef<HTMLVideoElement>(null)
  const phase = home && !greeted ? 'welcome' : 'idle'
  const staticOnly = reduced || failed
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => { setReduced(query.matches); if (query.matches) setGreeted(true) }
    change()
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useEffect(() => { if (!home) setGreeted(true) }, [home])
  useEffect(() => {
    if (staticOnly) { welcome.current?.pause(); idle.current?.pause(); return }
    let active = true
    const video = phase === 'welcome' ? welcome.current : idle.current
    const other = phase === 'welcome' ? idle.current : welcome.current
    other?.pause()
    const timeout = window.setTimeout(() => { if (active) setFailed(true) }, 10000)
    const playing = () => { window.clearTimeout(timeout); if (active) setVisible(phase) }
    video?.addEventListener('playing', playing)
    video?.play()?.catch(() => { if (active) setFailed(true) })
    return () => { active = false; window.clearTimeout(timeout); video?.removeEventListener('playing', playing); video?.pause() }
  }, [phase, staticOnly])
  return <div className="companion-video" data-testid="avatar-video" data-media={staticOnly ? "poster" : phase}>
    <img src="/avatar-poster.webp" alt="AI 돌봄 동료 안내 아바타" width="512" height="512" fetchPriority="high" draggable={false}
      onError={e => { if (!e.currentTarget.src.endsWith('/assets/ai365-companion.png')) e.currentTarget.src = '/assets/ai365-companion.png' }} />
    {!staticOnly && <>
      <video ref={welcome} className={visible === 'welcome' ? 'is-visible' : ''} src="/avatar-welcome.mp4"
        muted playsInline preload="auto" aria-hidden="true" disablePictureInPicture
        onEnded={() => setGreeted(true)} onError={() => setFailed(true)} />
      <video ref={idle} className={visible === 'idle' ? 'is-visible' : ''} src="/avatar-idle.mp4"
        muted playsInline loop preload="auto" aria-hidden="true" disablePictureInPicture onError={() => setFailed(true)} />
    </>}
  </div>
}
