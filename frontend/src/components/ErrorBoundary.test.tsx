import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div>SAFE CONTENT</div>
      </ErrorBoundary>,
    )

    expect(screen.getByText('SAFE CONTENT')).toBeInTheDocument()
    expect(screen.queryByText('Bir şeyler ters gitti.')).not.toBeInTheDocument()
  })

  describe('when a child throws during render', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('renders the fallback message instead of crashing', () => {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      )

      expect(screen.getByText('Bir şeyler ters gitti.')).toBeInTheDocument()
      expect(screen.queryByText('SAFE CONTENT')).not.toBeInTheDocument()
    })
  })
})
