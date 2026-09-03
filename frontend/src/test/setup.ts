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

// jsdom does not implement window.matchMedia; UI primitives that render (e.g.
// sonner's Toaster, used by App.tsx) call it on mount to detect the OS theme.
// Polyfill a minimal no-op MediaQueryList so those components work under jsdom.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
