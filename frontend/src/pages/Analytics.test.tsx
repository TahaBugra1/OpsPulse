import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Analytics from './Analytics'
import type { AnalyticsSummary, DepartmentWorkload, SlaMetrics } from '@/lib/analytics'

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

function makeSummary(overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return {
    total_open: 3,
    total_assigned: 2,
    total_in_progress: 1,
    total_completed: 5,
    total_rejected: 1,
    total_overdue: 2,
    ...overrides,
  }
}

function makeSla(overrides: Partial<SlaMetrics> = {}): SlaMetrics {
  return {
    compliance_rate: 87,
    avg_resolution_hours: 5.5,
    ...overrides,
  }
}

function makeWorkload(): DepartmentWorkload[] {
  return [
    { department_name: 'IT', open: 1, assigned: 2, in_progress: 3, completed: 4, rejected: 0 },
    { department_name: 'İK', open: 0, assigned: 1, in_progress: 0, completed: 2, rejected: 1 },
  ]
}

// "Açık" is used both as the summary "OPEN" stat label and as the workload
// table's "Açık" column header, so unscoped text queries collide once both
// sections have rendered -- scope summary assertions to its own card.
function getSummaryCard() {
  return screen.getByText('Durum Özeti').closest('div[data-slot="card"]') as HTMLElement
}

function renderAnalytics() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Analytics />
    </QueryClientProvider>,
  )
}

describe('Analytics page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // AC2: summary section renders all 6 stats with correct Turkish labels and numbers
  it('renders the 6 summary stats with correct labels and values', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    await waitFor(() => expect(within(getSummaryCard()).getByText('Açık')).toBeInTheDocument())

    const summaryCard = getSummaryCard()

    // total_assigned and total_overdue are both "2" in makeSummary(), so a bare
    // getByText('2') would match twice -- pair each label with its own value by
    // scoping to that stat's own label+value container instead.
    function getStatValue(label: string) {
      const labelEl = within(summaryCard).getByText(label)
      const container = labelEl.closest('div.flex') as HTMLElement
      return within(container).getByText((_content, el) => el?.tagName === 'SPAN' && el !== labelEl)
        .textContent
    }

    expect(within(summaryCard).getByText('Açık')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Atandı')).toBeInTheDocument()
    expect(within(summaryCard).getByText('İşlemde')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Tamamlandı')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Reddedildi')).toBeInTheDocument()
    expect(within(summaryCard).getByText('Gecikmiş')).toBeInTheDocument()

    expect(getStatValue('Açık')).toBe('3')
    expect(getStatValue('Atandı')).toBe('2')
    expect(getStatValue('İşlemde')).toBe('1')
    expect(getStatValue('Tamamlandı')).toBe('5')
    expect(getStatValue('Reddedildi')).toBe('1')
    expect(getStatValue('Gecikmiş')).toBe('2')
  })

  // AC3: SLA section renders compliance rate and average resolution hours correctly
  it('renders SLA compliance rate and average resolution time from a non-null response', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla({ compliance_rate: 87, avg_resolution_hours: 5.5 })))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('%87')).toBeInTheDocument())
    expect(screen.getByText('5.5 saat')).toBeInTheDocument()
    expect(screen.getByText('SLA Uyum Oranı')).toBeInTheDocument()
    expect(screen.getByText('Ortalama Çözüm Süresi')).toBeInTheDocument()
  })

  // AC4: workload section renders one row per department with all 6 columns correct
  it('renders a workload table row per department with correct columns', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const table = screen.getByRole('table')
    expect(within(table).getByText('Departman')).toBeInTheDocument()

    const itRow = within(table).getByText('IT').closest('tr')
    expect(itRow).not.toBeNull()
    const itCells = within(itRow as HTMLElement).getAllByRole('cell')
    expect(itCells.map((c) => c.textContent)).toEqual(['IT', '1', '2', '3', '4', '0'])

    const ikRow = within(table).getByText('İK').closest('tr')
    expect(ikRow).not.toBeNull()
    const ikCells = within(ikRow as HTMLElement).getAllByRole('cell')
    expect(ikCells.map((c) => c.textContent)).toEqual(['İK', '0', '1', '0', '2', '1'])
  })

  // AC5: independent failure isolation -- summary fails while sla and workload succeed
  it('shows an error + retry for the summary section while SLA and workload still render correctly', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    expect(screen.getByRole('button', { name: 'Tekrar Dene' })).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('%87')).toBeInTheDocument())
    expect(screen.getByText('5.5 saat')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByText('IT')).toBeInTheDocument()

    // summary section stats never rendered
    expect(within(getSummaryCard()).queryByText('Açık')).not.toBeInTheDocument()
  })

  // AC5: independent failure isolation -- sla fails while summary and workload succeed
  it('shows an error + retry for the SLA section while summary and workload still render correctly', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu hatası')
    expect(screen.getByRole('button', { name: 'Tekrar Dene' })).toBeInTheDocument()

    await waitFor(() => expect(within(getSummaryCard()).getByText('Açık')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByText('IT')).toBeInTheDocument()

    // SLA section data never rendered
    expect(screen.queryByText('SLA Uyum Oranı')).not.toBeInTheDocument()
  })

  // AC6: null avg_resolution_hours -> "Henüz tamamlanmış talep yok", no raw compliance/hours values
  it('shows "Henüz tamamlanmış talep yok" when avg_resolution_hours is null', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, { compliance_rate: 0, avg_resolution_hours: null }))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Henüz tamamlanmış talep yok')).toBeInTheDocument())
    expect(screen.queryByText('%0')).not.toBeInTheDocument()
    expect(screen.queryByText('SLA Uyum Oranı')).not.toBeInTheDocument()
    expect(screen.queryByText('Ortalama Çözüm Süresi')).not.toBeInTheDocument()
  })

  // AC6 negative companion: compliance_rate 0 but avg_resolution_hours real -> data renders, no null message
  it('renders real 0% compliance data instead of the null message when avg_resolution_hours is not null', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, { compliance_rate: 0, avg_resolution_hours: 2.5 }))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('%0')).toBeInTheDocument())
    expect(screen.getByText('2.5 saat')).toBeInTheDocument()
    expect(screen.queryByText('Henüz tamamlanmış talep yok')).not.toBeInTheDocument()
  })

  // AC5: loading state for a section shown before its data resolves, independent of the others
  it('shows "Yükleniyor..." for a section before its data resolves', async () => {
    let resolveSummary: (value: Response) => void = () => {}
    vi.mocked(fetch)
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveSummary = resolve
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    expect(screen.getAllByText('Yükleniyor...').length).toBeGreaterThan(0)

    resolveSummary(jsonResponse(200, makeSummary()))
    await waitFor(() => expect(within(getSummaryCard()).getByText('Açık')).toBeInTheDocument())
  })

  // Retry button: after a section's failure, a successful re-fetch shows data
  it('re-fetches and shows data when "Tekrar Dene" is clicked after a summary failure', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(500, 'Sunucu hatası'))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))

    renderAnalytics()

    const retryButton = await screen.findByRole('button', { name: 'Tekrar Dene' })

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeSummary()))
    await user.click(retryButton)

    await waitFor(() => expect(within(getSummaryCard()).getByText('Açık')).toBeInTheDocument())
  })

  // AC9 (page-level): empty workload -> friendly empty-state message
  it('renders "Henüz departman verisi yok" for an empty workload list', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, []))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Henüz departman verisi yok')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
