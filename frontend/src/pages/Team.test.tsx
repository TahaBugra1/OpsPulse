import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Team from './Team'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import type { TeamMember } from '@/lib/users'

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
  } as unknown as Response
}

function errorResponse(status: number, message: string) {
  return jsonResponse(status, { message })
}

const authorityUser: AuthUser = {
  id: 'authority-1',
  name: 'Ayşe',
  surname: 'Yetkili',
  email: 'ayse.yetkili@example.com',
  role: 'DEPARTMENT_AUTHORITY',
  department_id: 'dept-it',
}

function seedSession(user: AuthUser = authorityUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

function makeTeamMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'member-1',
    name: 'Taha',
    surname: 'Bugra',
    email: 'taha@example.com',
    is_active: true,
    ...overrides,
  }
}

function renderTeam(user: AuthUser = authorityUser) {
  seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/team']}>
          <Team />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('Team page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC1: while the GET /api/users/team request is in flight, the pending
  // message is shown.
  it('shows "Yükleniyor..." while the request is pending', () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))

    renderTeam()

    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument()
  })

  // AC1/AC5: a loaded response renders a table with the exact headers, an
  // "Aktif"/"Pasif" badge per row's is_active, "{name} {surname}" concatenation,
  // and a null surname renders as just the name with no literal "null".
  it('renders the team table with headers, Aktif/Pasif badges, and name+surname (including a null surname)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, [
        makeTeamMember({ id: 'member-1', name: 'Taha', surname: 'Bugra', is_active: true }),
        makeTeamMember({ id: 'member-2', name: 'Ada', surname: null, is_active: false }),
      ]),
    )

    renderTeam()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual(['Ad Soyad', 'Email', 'Durum'])

    const rows = screen.getAllByRole('row')
    // rows[0] is the header row.
    const firstRow = rows[1]
    const secondRow = rows[2]

    expect(within(firstRow).getByText('Taha Bugra')).toBeInTheDocument()
    expect(within(firstRow).getByText('Aktif')).toBeInTheDocument()

    expect(within(secondRow).getByText('Ada')).toBeInTheDocument()
    expect(within(secondRow).getByText('Ada').textContent).not.toContain('null')
    expect(within(secondRow).getByText('Pasif')).toBeInTheDocument()
  })

  // AC4: an empty team renders the controlled empty-state message, never a
  // broken/empty table.
  it('shows the empty state for an empty team and renders no table', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, []))

    renderTeam()

    expect(await screen.findByText('Departmanınızda henüz çalışan yok')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // A failed fetch surfaces an error via role="alert" with a working
  // "Tekrar Dene" retry button that can recover into the loaded table.
  it('shows a role="alert" error with the backend message and recovers via "Tekrar Dene"', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(500, 'Ekip listesi getirilemedi, lütfen tekrar deneyin'))

    renderTeam()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ekip listesi getirilemedi, lütfen tekrar deneyin')

    const retryButton = screen.getByRole('button', { name: 'Tekrar Dene' })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, [makeTeamMember()]))
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByText('Taha Bugra')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // A failed fetch whose response body has no `message` field: apiGet's own
  // ApiError (lib/api.ts) always carries a message - either the backend's, or
  // its own generic "İstek başarısız oldu (<status>)" fallback - and that
  // ApiError is always `instanceof Error`. So Team.tsx's `error instanceof
  // Error ? error.message : '...'` branch always takes the `error.message`
  // side; its own hardcoded fallback string is therefore never actually
  // reachable through apiGet. This asserts the real rendered text.
  it('renders api.ts own generic fallback message when the failed response has no message field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(500, {}))

    renderTeam()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('İstek başarısız oldu (500)')
  })
})
