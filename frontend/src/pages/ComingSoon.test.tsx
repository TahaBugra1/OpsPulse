import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ComingSoon from './ComingSoon'

describe('ComingSoon', () => {
  it('renders the given title prop as a heading', () => {
    render(<ComingSoon title="Kuyruk" />)
    expect(screen.getByRole('heading', { name: 'Kuyruk' })).toBeInTheDocument()
  })

  it('renders "Bu özellik yakında eklenecek"', () => {
    render(<ComingSoon title="Kuyruk" />)
    expect(screen.getByText('Bu özellik yakında eklenecek')).toBeInTheDocument()
  })

  it('renders a different title for a different title prop, proving the prop drives content', () => {
    render(<ComingSoon title="Kullanıcılar" />)
    expect(screen.getByRole('heading', { name: 'Kullanıcılar' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Kuyruk' })).not.toBeInTheDocument()
    expect(screen.getByText('Bu özellik yakında eklenecek')).toBeInTheDocument()
  })
})
