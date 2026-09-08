import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
}

/** 화면 어디서든 예상치 못한 렌더링 오류가 나면 앱 전체가 빈 흰 화면으로 사라지는
 * 대신(React는 에러 경계가 없으면 트리를 통째로 언마운트한다) 재시도 안내를 보여준다.
 * 요양보호사가 입력한 내용은 draft로 localStorage/서버에 저장돼 있으므로, 새로고침
 * 후 다시 들어오면 이어서 진행할 수 있다. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-xl font-bold text-slate-900">잠시 연결이 어려워요. 다시 시도해주세요.</p>
          <p className="text-slate-500 text-base">지금까지 입력한 내용은 남아 있습니다.</p>
          <button
            onClick={() => window.location.reload()}
            className="min-h-[52px] rounded-full bg-teal-600 text-white text-lg font-bold px-8 hover:bg-teal-700 transition"
          >
            새로고침
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
