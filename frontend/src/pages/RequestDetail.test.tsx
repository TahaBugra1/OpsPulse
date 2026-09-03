import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RequestDetail from './RequestDetail'
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

function renderDetail(id = 'uuid-1111-2222') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/requests/${id}`]}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetail />} />
        </Routes>
      </MemoryRouter>
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

  // AC4: no comment-adding form exists
  it('does not render any comment-adding form', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeRequest()))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderDetail()

    await waitFor(() => expect(screen.getByText('Yorumlar')).toBeInTheDocument())

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
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
})
