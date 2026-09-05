import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RequestDetail from './RequestDetail'
import { AuthProvider } from '@/context/AuthContext'
import type { AuthUser } from '@/lib/authStorage'
import type { RequestComment, RequestListItem } from '@/lib/requests'

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

function makeRequest(overrides: Partial<RequestListItem> = {}): RequestListItem {
  return {
    id: 'uuid-1111-2222',
    request_number: 42,
    title: 'Yazıcı bozuldu',
    description: 'Ofis yazıcısı çalışmıyor, kağıt sıkışması var.',
    request_type_id: 'type-1',
    department_id: 'dept-1',
    created_by: 'user-1',
    assigned_to: 'user-2',
    priority: 'HIGH',
    status: 'ASSIGNED',
    sla_due_at: '2026-09-04T00:00:00.000Z',
    created_at: '2026-09-03T10:00:00.000Z',
    updated_at: '2026-09-03T10:00:00.000Z',
    is_overdue: false,
    request_type_name: 'Donanım Arızası',
    department_name: 'IT',
    created_by_name: 'Taha',
    assigned_to_name: 'Ahmet',
    ...overrides,
  }
}

function makeComment(overrides: Partial<RequestComment> = {}): RequestComment {
  return {
    id: 'c1',
    request_id: 'uuid-1111-2222',
    author_id: 'user-1',
    content: 'Durum nedir?',
    created_at: '2026-09-03T11:00:00.000Z',
    author_name: 'Taha',
    ...overrides,
  }
}

// EMPLOYEE who created the default makeRequest() request (created_by: 'user-1').
// A plain EMPLOYEE-as-creator has zero action-button visibility (no claim/start/
// complete/reject/priority-change apply), so this is the safe default for tests
// that only care about read-only rendering of the page.
const fakeUser: AuthUser = {
  id: 'user-1',
  name: 'Taha',
  surname: null,
  email: 'taha@example.com',
  role: 'EMPLOYEE',
  department_id: null,
}

function seedSession(user: AuthUser) {
  sessionStorage.setItem('opspulse_token', 'tok-123')
  sessionStorage.setItem('opspulse_user', JSON.stringify(user))
}

function renderDetail(user: AuthUser = fakeUser, id = 'uuid-1111-2222') {
  seedSession(user)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/requests/${id}`]}>
          <Routes>
            <Route path="/requests/:id" element={<RequestDetail />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('RequestDetail page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC7: loading state shown while either query is pending
  it('shows a loading indicator while the request/comments queries are pending', async () => {
    let resolveRequest: (value: Response) => void = () => {}
    let resolveComments: (value: Response) => void = () => {}
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRequest = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveComments = resolve
          }),
      )

    renderDetail()

    expect(screen.getByText('Yükleniyor...')).toBeInTheDocument()
    expect(screen.queryByText('Yorumlar')).not.toBeInTheDocument()

    resolveRequest(jsonResponse(200, makeRequest()))
    resolveComments(jsonResponse(200, []))
    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
  })

  // AC4: calls both GET /api/requests/:id and GET /api/requests/:id/comments, renders full detail + comments
  it('calls both request and comments endpoints and renders all detail fields plus comments', async () => {
    const request = makeRequest()
    const comments = [makeComment({ author_name: 'Ahmet', content: 'İlgileniyorum' })]
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, request))
      .mockResolvedValueOnce(jsonResponse(200, comments))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())

    const calledUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
    expect(calledUrls.some((u) => u.endsWith('/api/requests/uuid-1111-2222'))).toBe(true)
    expect(calledUrls.some((u) => u.endsWith('/api/requests/uuid-1111-2222/comments'))).toBe(true)

    expect(screen.getByText(/#42 — Yazıcı bozuldu/)).toBeInTheDocument()
    expect(screen.getByText('Ofis yazıcısı çalışmıyor, kağıt sıkışması var.')).toBeInTheDocument()
    expect(screen.getByText('Atandı')).toBeInTheDocument()
    expect(screen.getByText('Yüksek')).toBeInTheDocument()
    expect(screen.getByText('Donanım Arızası')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
    expect(screen.getAllByText('Taha').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ahmet').length).toBe(2)
    expect(
      screen.getByText(new Date(request.created_at).toLocaleString('tr-TR')),
    ).toBeInTheDocument()

    expect(screen.getByText('İlgileniyorum')).toBeInTheDocument()
    expect(
      screen.getByText(new Date(comments[0].created_at).toLocaleString('tr-TR')),
    ).toBeInTheDocument()
    expect(screen.queryByText('Henüz yorum yok')).not.toBeInTheDocument()
  })

  // AC6: comment form now exists for a non-ADMIN user, positioned after the comments list
  // (replaces the old "does not render any comment-adding form" expectation, which predated AC6)
  it('renders a comment-adding form after the comments list for a non-ADMIN user', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
      .mockResolvedValueOnce(jsonResponse(200, [makeComment()]))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())

    const input = screen.getByLabelText('Yorum Ekle')
    expect(input).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeInTheDocument()

    // Positioned after the comments list: the comment's own text appears before the form input in the DOM
    const position = input.compareDocumentPosition(screen.getByText('Durum nedir?'))
    // Node.DOCUMENT_POSITION_PRECEDING === 2: the comment text node precedes the input
    expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  // AC4: empty comments list -> "Henüz yorum yok"
  it('renders "Henüz yorum yok" when there are no comments', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Henüz yorum yok')).toBeInTheDocument())
  })

  // AC6: request query 404 -> error UI shown, detail fields never rendered
  it('renders the error message and retry button when the request query fails, without leaking any request content', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(404, 'Talep bulunamadı'))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent('Talep bulunamadı')
    expect(screen.getByRole('button', { name: 'Tekrar Dene' })).toBeInTheDocument()
    expect(screen.queryByText('Yorumlar')).not.toBeInTheDocument()
    expect(screen.queryByText(/#42/)).not.toBeInTheDocument()
  })

  // AC6: 403 on the request query -> same error UI
  it('renders the error message when the request query returns 403', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(403, 'Bu işlem için yetkiniz yok'))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent('Bu işlem için yetkiniz yok')
  })

  // AC5: comments query failing even though the request query succeeds -> combined error UI, no leak
  it('renders the error UI when only the comments query fails, per the combined isError logic', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
      .mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))

    renderDetail()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Yorumlar')).not.toBeInTheDocument()
  })

  // AC5: retry button re-triggers both queries
  it('retries both queries when the retry button is clicked after a failure', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    const retryButton = await screen.findByRole('button', { name: 'Tekrar Dene' })

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
      .mockResolvedValueOnce(jsonResponse(200, []))

    await user.click(retryButton)

    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  // AC8: "Gecikmiş" badge shown on the detail page when is_overdue is true
  it('shows the "Gecikmiş" badge when the request is overdue', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest({ is_overdue: true })))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Gecikmiş')).toBeInTheDocument())
  })

  // AC8: no badge when not overdue
  it('does not show the "Gecikmiş" badge when the request is not overdue', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest({ is_overdue: false })))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
    expect(screen.queryByText('Gecikmiş')).not.toBeInTheDocument()
  })

  // AC4: assigned_to_name renders "-" when null (unassigned request)
  it('renders "-" for assigned_to_name when the request is unassigned', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest({ assigned_to: null, assigned_to_name: null, status: 'OPEN' })))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  // ── AC1: claim ("Üstlen") ────────────────────────────────────────────────

  describe('claim action (AC1)', () => {
    const authorityDept1: AuthUser = { ...fakeUser, id: 'authority-1', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }
    const authorityDept2: AuthUser = { ...fakeUser, id: 'authority-2', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-2' }

    it('shows "Üstlen" for a DEPARTMENT_AUTHORITY of the request\'s department on an OPEN request, and claiming it invalidates and refetches the request', async () => {
      const user = userEvent.setup()
      // A stateful router mock: however many refetches the invalidation fan-out
      // triggers (both ['requests', id] and ['requests'] are invalidated on
      // success, and the latter prefix-matches the comments query too), every
      // GET reflects current server state instead of running out of queued
      // mockResolvedValueOnce responses.
      let current = makeRequest({ status: 'OPEN', assigned_to: null, assigned_to_name: null })
      const comments: RequestComment[] = []
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const u = String(url)
        const method = (init?.method as string | undefined) ?? 'GET'
        if (method === 'GET' && u.endsWith('/comments')) return jsonResponse(200, comments)
        if (method === 'GET') return jsonResponse(200, current)
        if (method === 'POST' && u.endsWith('/assign')) {
          current = { ...current, status: 'ASSIGNED', assigned_to: 'authority-1', assigned_to_name: 'Authority One' }
          return jsonResponse(200, { id: current.id, status: 'ASSIGNED' })
        }
        return jsonResponse(404, { message: 'unexpected call' })
      })

      renderDetail(authorityDept1)

      const claimButton = await screen.findByRole('button', { name: 'Üstlen' })
      await user.click(claimButton)

      const assignCall = vi
        .mocked(fetch)
        .mock.calls.find(([u, init]) => String(u).endsWith('/assign') && init?.method === 'POST')
      expect(assignCall).toBeDefined()
      expect(assignCall?.[1]?.body).toBeUndefined()

      // The claim succeeded and the request is now ASSIGNED, so "Üstlen" disappears
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not show "Üstlen" for an EMPLOYEE', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'OPEN', assigned_to: null, assigned_to_name: null })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(fakeUser)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument()
    })

    it('does not show "Üstlen" for a DEPARTMENT_AUTHORITY of a different department', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'OPEN', assigned_to: null, assigned_to_name: null })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(authorityDept2)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument()
    })
  })

  // ── AC2: start ("İşleme Al") ─────────────────────────────────────────────

  describe('start action (AC2)', () => {
    const assignee: AuthUser = { ...fakeUser, id: 'user-2', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }
    const otherAuthoritySameDept: AuthUser = { ...fakeUser, id: 'authority-3', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }

    it('shows "İşleme Al" for the assignee on an ASSIGNED request and sends PATCH status IN_PROGRESS', async () => {
      const user = userEvent.setup()
      let current = makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2' })
      const comments: RequestComment[] = []
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const u = String(url)
        const method = (init?.method as string | undefined) ?? 'GET'
        if (method === 'GET' && u.endsWith('/comments')) return jsonResponse(200, comments)
        if (method === 'GET') return jsonResponse(200, current)
        if (method === 'PATCH' && u.endsWith('/status')) {
          const body = JSON.parse(init?.body as string)
          current = { ...current, status: body.status }
          return jsonResponse(200, { id: current.id, status: current.status })
        }
        return jsonResponse(404, { message: 'unexpected call' })
      })

      renderDetail(assignee)

      const startButton = await screen.findByRole('button', { name: 'İşleme Al' })
      await user.click(startButton)

      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(([u, init]) => String(u).endsWith('/status') && init?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      expect(JSON.parse(patchCall?.[1]?.body as string)).toEqual({ status: 'IN_PROGRESS' })

      // The status transition succeeded, so "İşleme Al" is replaced by "Tamamla"
      await waitFor(() => expect(screen.getByRole('button', { name: 'Tamamla' })).toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('does not show "İşleme Al" for a different DEPARTMENT_AUTHORITY of the same department who is not the assignee', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2' })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(otherAuthoritySameDept)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'İşleme Al' })).not.toBeInTheDocument()
    })
  })

  // ── AC3: complete ("Tamamla") ────────────────────────────────────────────

  describe('complete action (AC3)', () => {
    const assignee: AuthUser = { ...fakeUser, id: 'user-2', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }

    it('shows "Tamamla" for the assignee on an IN_PROGRESS request and sends PATCH status COMPLETED immediately, with no confirmation dialog', async () => {
      const user = userEvent.setup()
      let current = makeRequest({ status: 'IN_PROGRESS', assigned_to: 'user-2' })
      const comments: RequestComment[] = []
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const u = String(url)
        const method = (init?.method as string | undefined) ?? 'GET'
        if (method === 'GET' && u.endsWith('/comments')) return jsonResponse(200, comments)
        if (method === 'GET') return jsonResponse(200, current)
        if (method === 'PATCH' && u.endsWith('/status')) {
          const body = JSON.parse(init?.body as string)
          current = { ...current, status: body.status }
          return jsonResponse(200, { id: current.id, status: current.status })
        }
        return jsonResponse(404, { message: 'unexpected call' })
      })

      renderDetail(assignee)

      const completeButton = await screen.findByRole('button', { name: 'Tamamla' })
      await user.click(completeButton)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(([u, init]) => String(u).endsWith('/status') && init?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      expect(JSON.parse(patchCall?.[1]?.body as string)).toEqual({ status: 'COMPLETED' })

      // The request is now COMPLETED (terminal), so no action buttons remain
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Tamamla' })).not.toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  // ── AC4: reject ("Reddet") ───────────────────────────────────────────────

  describe('reject action (AC4)', () => {
    const authorityDept1: AuthUser = { ...fakeUser, id: 'authority-1', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }
    const assignee: AuthUser = { ...fakeUser, id: 'user-2', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }

    it('shows "Reddet" for a DEPARTMENT_AUTHORITY of the department on an OPEN request', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'OPEN', assigned_to: null, assigned_to_name: null })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(authorityDept1)

      expect(await screen.findByRole('button', { name: 'Reddet' })).toBeInTheDocument()
    })

    it('only shows "Reddet" for the assignee (not another DEPARTMENT_AUTHORITY of the same department) on an ASSIGNED/IN_PROGRESS request', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2' })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(authorityDept1)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Reddet' })).not.toBeInTheDocument()
    })

    it('opens a dialog when "Reddet" is clicked', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2' })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(assignee)

      const rejectButton = await screen.findByRole('button', { name: 'Reddet' })
      await user.click(rejectButton)

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Talebi Reddet')).toBeInTheDocument()
    })

    it('blocks submitting the reject dialog with an empty note client-side and does not call fetch for the PATCH', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2' })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(assignee)

      const rejectButton = await screen.findByRole('button', { name: 'Reddet' })
      await user.click(rejectButton)
      await screen.findByRole('dialog')

      const fetchCallsBefore = vi.mocked(fetch).mock.calls.length
      const submitButtons = screen.getAllByRole('button', { name: 'Reddet' })
      const dialogSubmit = submitButtons[submitButtons.length - 1]
      await user.click(dialogSubmit)

      expect(await screen.findByText('Red sebebi zorunlu')).toBeInTheDocument()
      expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore)
    })

    it('submits a non-empty reject note as PATCH status REJECTED with the note, then closes the dialog on success', async () => {
      const user = userEvent.setup()
      let current = makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2' })
      const comments: RequestComment[] = []
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const u = String(url)
        const method = (init?.method as string | undefined) ?? 'GET'
        if (method === 'GET' && u.endsWith('/comments')) return jsonResponse(200, comments)
        if (method === 'GET') return jsonResponse(200, current)
        if (method === 'PATCH' && u.endsWith('/status')) {
          const body = JSON.parse(init?.body as string)
          current = { ...current, status: body.status }
          return jsonResponse(200, { id: current.id, status: current.status })
        }
        return jsonResponse(404, { message: 'unexpected call' })
      })

      renderDetail(assignee)

      const rejectButton = await screen.findByRole('button', { name: 'Reddet' })
      await user.click(rejectButton)
      await screen.findByRole('dialog')

      const noteInput = screen.getByLabelText('Red Sebebi')
      await user.type(noteInput, 'Stok yok')

      const submitButtons = screen.getAllByRole('button', { name: 'Reddet' })
      const dialogSubmit = submitButtons[submitButtons.length - 1]
      await user.click(dialogSubmit)

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(([u, init]) => String(u).endsWith('/status') && init?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      expect(JSON.parse(patchCall?.[1]?.body as string)).toEqual({ status: 'REJECTED', note: 'Stok yok' })

      // Terminal state: no action buttons remain
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reddet' })).not.toBeInTheDocument())
    })
  })

  // ── AC5: priority select ─────────────────────────────────────────────────

  describe('priority change (AC5)', () => {
    const assignee: AuthUser = { ...fakeUser, id: 'user-2', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }

    it('shows the priority select for the assignee on an ASSIGNED/IN_PROGRESS request and changing it fires PATCH priority immediately', async () => {
      const user = userEvent.setup()
      let current = makeRequest({ status: 'ASSIGNED', assigned_to: 'user-2', priority: 'HIGH' })
      const comments: RequestComment[] = []
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const u = String(url)
        const method = (init?.method as string | undefined) ?? 'GET'
        if (method === 'GET' && u.endsWith('/comments')) return jsonResponse(200, comments)
        if (method === 'GET') return jsonResponse(200, current)
        if (method === 'PATCH' && u.endsWith('/priority')) {
          const body = JSON.parse(init?.body as string)
          current = { ...current, priority: body.priority }
          return jsonResponse(200, { id: current.id, priority: current.priority })
        }
        return jsonResponse(404, { message: 'unexpected call' })
      })

      renderDetail(assignee)

      const select = (await screen.findByLabelText('Öncelik Değiştir')) as HTMLSelectElement
      await user.selectOptions(select, 'MEDIUM')

      const patchCall = vi
        .mocked(fetch)
        .mock.calls.find(([u, init]) => String(u).endsWith('/priority') && init?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      expect(JSON.parse(patchCall?.[1]?.body as string)).toEqual({ priority: 'MEDIUM' })

      // No separate save button/click needed: the change event alone triggers the request,
      // and the refetched value confirms it landed
      await waitFor(() => expect(select).toHaveValue('MEDIUM'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  // ── AC6: comment form ────────────────────────────────────────────────────

  describe('comment form (AC6)', () => {
    it('does not render the comment form for an ADMIN user', async () => {
      const admin: AuthUser = { ...fakeUser, role: 'ADMIN', department_id: null }
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(admin)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())
      expect(screen.queryByLabelText('Yorum Ekle')).not.toBeInTheDocument()
    })

    it('submits valid comment content as POST /api/requests/:id/comments, clears the input, and refetches the comment list on success', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail()

      const input = await screen.findByLabelText('Yorum Ekle')
      await user.type(input, 'Merhaba')

      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(201, { id: 'c2', content: 'Merhaba' }))
        .mockResolvedValueOnce(jsonResponse(200, [makeComment({ id: 'c2', content: 'Merhaba' })]))

      await user.click(screen.getByRole('button', { name: 'Gönder' }))

      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
      const [url, options] = vi.mocked(fetch).mock.calls[2]
      expect(String(url)).toContain('/api/requests/uuid-1111-2222/comments')
      expect(options?.method).toBe('POST')
      expect(JSON.parse(options?.body as string)).toEqual({ content: 'Merhaba' })

      const refetchUrl = String(vi.mocked(fetch).mock.calls[3][0])
      expect(refetchUrl.endsWith('/api/requests/uuid-1111-2222/comments')).toBe(true)

      await waitFor(() => expect(screen.getByLabelText('Yorum Ekle')).toHaveValue(''))
    })

    it('blocks submitting empty comment content client-side and does not call fetch for the POST', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail()

      await screen.findByLabelText('Yorum Ekle')
      const fetchCallsBefore = vi.mocked(fetch).mock.calls.length

      await user.click(screen.getByRole('button', { name: 'Gönder' }))

      expect(await screen.findByText('Yorum boş olamaz')).toBeInTheDocument()
      expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallsBefore)
    })
  })

  // ── AC7 / AC8: action error handling ─────────────────────────────────────

  describe('action error handling (AC7, AC8)', () => {
    const authorityDept1: AuthUser = { ...fakeUser, id: 'authority-1', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }

    it('shows the backend error message via role="alert" on a 409 claim failure and triggers an extra GET refetch of the request', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'OPEN', assigned_to: null, assigned_to_name: null })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(authorityDept1)

      const claimButton = await screen.findByRole('button', { name: 'Üstlen' })

      vi.mocked(fetch)
        .mockResolvedValueOnce(errorResponse(409, 'Bu talep zaten üstlenildi'))
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'ASSIGNED', assigned_to: 'someone-else' })))

      await user.click(claimButton)

      expect(await screen.findByRole('alert')).toHaveTextContent('Bu talep zaten üstlenildi')

      // 409 triggers an explicit extra GET of the request (AC7 refetch-on-409 behavior)
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
      const refetchUrl = String(vi.mocked(fetch).mock.calls[3][0])
      expect(refetchUrl.endsWith('/api/requests/uuid-1111-2222')).toBe(true)
    })

    it('shows the backend error message via role="alert" on a non-409 (403) claim failure without a page crash or extra refetch', async () => {
      const user = userEvent.setup()
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'OPEN', assigned_to: null, assigned_to_name: null })))
        .mockResolvedValueOnce(jsonResponse(200, [makeComment()]))

      renderDetail(authorityDept1)

      const claimButton = await screen.findByRole('button', { name: 'Üstlen' })

      vi.mocked(fetch).mockResolvedValueOnce(errorResponse(403, 'Bu işlem için yetkiniz yok'))

      await user.click(claimButton)

      expect(await screen.findByRole('alert')).toHaveTextContent('Bu işlem için yetkiniz yok')

      // page did not crash: other content (the comments list) is still visible
      expect(screen.getByText('Durum nedir?')).toBeInTheDocument()

      // no extra refetch on a non-409 failure: exactly the 2 initial GETs + the failed POST
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    })
  })

  // ── AC9: terminal states hide every action ──────────────────────────────

  describe('terminal states hide all actions (AC9)', () => {
    const assignee: AuthUser = { ...fakeUser, id: 'user-2', role: 'DEPARTMENT_AUTHORITY', department_id: 'dept-1' }

    it('shows no action buttons or priority select for a COMPLETED request, even for the former assignee, while the comment form remains', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'COMPLETED', assigned_to: 'user-2' })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(assignee)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'İşleme Al' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Tamamla' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reddet' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Öncelik Değiştir')).not.toBeInTheDocument()

      expect(screen.getByLabelText('Yorum Ekle')).toBeInTheDocument()
    })

    it('shows no action buttons or priority select for a REJECTED request, even for the former assignee', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse(200, makeRequest({ status: 'REJECTED', assigned_to: 'user-2' })))
        .mockResolvedValueOnce(jsonResponse(200, []))

      renderDetail(assignee)

      await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())

      expect(screen.queryByRole('button', { name: 'Üstlen' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'İşleme Al' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Tamamla' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reddet' })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Öncelik Değiştir')).not.toBeInTheDocument()

      expect(screen.getByLabelText('Yorum Ekle')).toBeInTheDocument()
    })
  })
})
