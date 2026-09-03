import '@testing-library/jest-dom'

// jsdom does not implement PointerEvent; some UI primitives (e.g. @base-ui
// checkbox/button) construct one on click/keyboard interaction. Polyfill a
// minimal PointerEvent so those components work under jsdom in tests.
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId?: number
    pointerType?: string
    isPrimary?: boolean

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId
      this.pointerType = params.pointerType
      this.isPrimary = params.isPrimary
    }
  }

  // @ts-expect-error jsdom lacks a native PointerEvent implementation
  window.PointerEvent = PointerEventPolyfill
}
