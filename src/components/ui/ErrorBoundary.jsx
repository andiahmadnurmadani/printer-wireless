import { Component } from 'react'

/**
 * ErrorBoundary — catches render errors so the app never silently unmounts.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('KroomPrint render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-kroom-noise flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-vanilla-200 border-2 border-dark-black-900 rounded-[22px] p-8 relative">
            <div className="absolute -top-[9px] -left-[9px] w-[18px] h-[18px] border border-dark-black-900 bg-err-500 rounded-[2px] pointer-events-none" />
            <div className="font-figtree font-bold text-[20px] text-dark-black-900 mb-2">Something went wrong</div>
            <div className="font-geist text-[13px] text-dark-black-900/70 bg-vanilla-100 border border-dark-black-900/30 rounded-[12px] p-4 overflow-auto max-h-[240px] whitespace-pre-wrap">
              {this.state.error?.message || String(this.state.error)}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 px-5 py-2.5 rounded-[12px] border-2 border-dark-black-900 bg-lime-300 hover:bg-lime-500 font-figtree font-semibold text-[14px] text-dark-black-900 cursor-pointer"
            >
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
