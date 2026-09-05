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

// jsdom does not implement ResizeObserver; @base-ui popup positioning (e.g.
// dropdown-menu, used by AppShell's user menu) observes the anchor/floating
// element size via floating-ui's autoUpdate. Without this, that observer
// setup hangs the component under test indefinitely. Polyfill a minimal
// no-op ResizeObserver so those components work under jsdom in tests.
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver
}

// jsdom does not implement IntersectionObserver either; floating-ui (used
// under the hood by @base-ui's popup positioning, e.g. dropdown-menu) uses
// it as part of its layout-shift detection in autoUpdate. Polyfill a
// minimal no-op IntersectionObserver so those components work under jsdom.
if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'undefined') {
  class IntersectionObserverPolyfill {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: ReadonlyArray<number> = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  window.IntersectionObserver = IntersectionObserverPolyfill as unknown as typeof IntersectionObserver
}

// jsdom does not implement pointer capture or scrollIntoView; @base-ui's
// interactive primitives (e.g. dropdown-menu) call these during pointer
// interaction, and userEvent's pointer simulation hangs indefinitely when
// they're missing entirely rather than throwing. Polyfill them as no-ops.
if (typeof window !== 'undefined' && typeof window.HTMLElement !== 'undefined') {
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {}
  }
}

// jsdom reports 0x0 for every element's bounding rect (no real layout
// engine). @base-ui's popup positioning (floating-ui) treats a 0x0 anchor
// as "not yet measurable" and repeatedly re-checks before rendering popup
// content, which is very slow under jsdom's fake rAF/timer loop. Stubbing
// a fixed non-zero rect lets it settle immediately instead. This is a
// perf mitigation, not a correctness requirement — no test asserts on
// real layout geometry.
if (typeof window !== 'undefined' && typeof window.Element !== 'undefined') {
  window.Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      toJSON() {},
    }) as DOMRect
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
