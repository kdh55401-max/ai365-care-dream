import { createRoot } from 'react-dom/client'
import CenterWorkspace from './CenterWorkspace'
import MemberGateway from './MemberGateway'
import '../index.css'
const choice = new URLSearchParams(window.location.search).get('screen')
const demo = new URL(window.location.href)
demo.searchParams.set('demo','1')
history.replaceState(null,'',demo.href)
createRoot(document.getElementById('root')!).render(choice === 'login' ? <MemberGateway /> : <CenterWorkspace />)
