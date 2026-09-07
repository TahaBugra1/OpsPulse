import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Analytics from './Analytics'
import type { AnalyticsSummary, DepartmentWorkload, DistributionData, SlaMetrics } from '@/lib/analytics'

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

function makeDistribution(overrides: Partial<DistributionData> = {}): DistributionData {
  return {
    status: [
      { status: 'OPEN', count: 3 },
      { status: 'ASSIGNED', count: 2 },
    ],
    priority: [
      { priority: 'HIGH', count: 1 },
      { priority: 'LOW', count: 4 },
    ],
    department: [{ department: 'Muhasebe', count: 5 }],
    requestType: [{ requestType: 'Donanım Arızası', count: 5 }],
    volumeOverTime: [
      { date: '2026-09-01', count: 2 },
      { date: '2026-09-02', count: 3 },
    ],
    ...overrides,
  }
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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

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
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Henüz departman verisi yok')).toBeInTheDocument())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('distribution charts (Analytics 2B)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function getCardByTitle(title: string) {
    return screen.getByText(title).closest('div[data-slot="card"]') as HTMLElement
  }

  // AC1: opening the page fires a GET to /api/analytics/distribution (default days=30)
  it('fetches the distribution endpoint with the default days=30 on mount', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Durum Dağılımı')).toBeInTheDocument())

    const distributionCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).includes('/api/analytics/distribution'),
    )
    expect(distributionCall).toBeDefined()
    expect(String(distributionCall?.[0])).toContain('days=30')
  })

  // AC2: the four categorical datasets render their data-derived text when non-zero.
  //
  // Note: recharts' bar-chart axis ticks go through an overlap-avoidance pass that,
  // under jsdom's zero real text measurement, tends to drop all but one tick when a
  // dataset has 2+ entries -- a known jsdom/recharts interaction limitation, not a
  // rendering bug in Analytics.tsx (confirmed by manual inspection: with a single
  // entry per dataset, the label reliably appears once its ~1.5s enter animation
  // settles; with 2+ entries, only one of the tick labels survives the cull, non-
  // deterministically). Using one entry per dataset here keeps this a reliable
  // assertion that the fetched value actually reached each of the 4 charts, per the
  // "labels/tooltip trigger text/LabelList numbers are sufficient proof" guidance --
  // it does not exercise recharts' multi-tick layout, which is a jsdom-rendering gap,
  // not an application bug.
  it('renders the four categorical distribution charts with their data-derived labels', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          makeDistribution({
            status: [{ status: 'COMPLETED', count: 6 }],
            priority: [{ priority: 'HIGH', count: 2 }],
            // A single word (not "Donanım Arızası") deliberately -- a request type
            // label wider than the YAxis category column wraps into multiple
            // <tspan> lines, and the space between the two words is lost from the
            // rendered <text>'s textContent, so a two-word getByText match would
            // fail for reasons unrelated to this AC (an SVG text-wrapping quirk,
            // not a real defect).
            requestType: [{ requestType: 'Donanım', count: 7 }],
            department: [{ department: 'Muhasebe', count: 9 }],
          }),
        ),
      )

    renderAnalytics()

    const statusCard = await screen.findByText('Durum Dağılımı').then(
      (el) => el.closest('div[data-slot="card"]') as HTMLElement,
    )
    // recharts' enter animation takes ~1.5s to settle under jsdom before the tick
    // <text> actually commits to the DOM -- the default RTL waitFor timeout (1s) is
    // too short, so it's extended here.
    await waitFor(() => expect(within(statusCard).getByText('Tamamlandı')).toBeInTheDocument(), {
      timeout: 3000,
    })

    const priorityCard = getCardByTitle('Öncelik Dağılımı')
    await waitFor(() => expect(within(priorityCard).getByText('Yüksek')).toBeInTheDocument(), {
      timeout: 3000,
    })

    const requestTypeCard = getCardByTitle('Talep Türü Dağılımı')
    await waitFor(
      () => expect(within(requestTypeCard).getByText('Donanım')).toBeInTheDocument(),
      { timeout: 3000 },
    )

    const departmentCard = getCardByTitle('Departman Dağılımı')
    await waitFor(() => expect(within(departmentCard).getByText('Muhasebe')).toBeInTheDocument(), {
      timeout: 3000,
    })
  })

  // AC2: the volume-over-time chart attempts to render when it has non-zero data
  it('renders the volume-over-time chart when data is non-empty', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

    const { container } = renderAnalytics()

    await waitFor(() => expect(screen.getByText('Zaman İçinde Hacim')).toBeInTheDocument())
    const volumeCard = getCardByTitle('Zaman İçinde Hacim')
    await waitFor(() =>
      expect(within(volumeCard).queryByText('Yükleniyor...')).not.toBeInTheDocument(),
    )
    expect(within(volumeCard).queryByText('Bu aralıkta veri yok')).not.toBeInTheDocument()
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
  })

  // AC3: clicking a day-range button re-fetches distribution with the new days value
  // and marks the clicked button as active via aria-pressed
  it('re-fetches with the new days value and marks the clicked range button active', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(jsonResponse(200, makeDistribution()))

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Zaman İçinde Hacim')).toBeInTheDocument())

    const button30 = screen.getByRole('button', { name: '30 gün' })
    const button7 = screen.getByRole('button', { name: '7 gün' })
    const button90 = screen.getByRole('button', { name: '90 gün' })

    expect(button30).toHaveAttribute('aria-pressed', 'true')
    expect(button7).toHaveAttribute('aria-pressed', 'false')
    expect(button90).toHaveAttribute('aria-pressed', 'false')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, makeDistribution()))
    await user.click(button7)

    await waitFor(() => {
      const lastCall = vi.mocked(fetch).mock.calls.at(-1)
      expect(String(lastCall?.[0])).toContain('days=7')
    })

    expect(button7).toHaveAttribute('aria-pressed', 'true')
    expect(button30).toHaveAttribute('aria-pressed', 'false')
    expect(button90).toHaveAttribute('aria-pressed', 'false')
  })

  // AC4: distribution failure shows exactly one alert card titled "Dağılımlar" with a
  // retry button, while the three pre-existing sections still render their own data
  it('shows a single "Dağılımlar" error card on distribution failure while other sections still render', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(errorResponse(500, 'Dağılım sunucu hatası'))

    renderAnalytics()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Dağılım sunucu hatası')

    const distributionsCard = getCardByTitle('Dağılımlar')
    expect(within(distributionsCard).getByRole('button', { name: 'Tekrar Dene' })).toBeInTheDocument()

    // the 5 chart sections don't render at all when distribution errored
    expect(screen.queryByText('Durum Dağılımı')).not.toBeInTheDocument()
    expect(screen.queryByText('Öncelik Dağılımı')).not.toBeInTheDocument()
    expect(screen.queryByText('Talep Türü Dağılımı')).not.toBeInTheDocument()
    expect(screen.queryByText('Departman Dağılımı')).not.toBeInTheDocument()
    expect(screen.queryByText('Zaman İçinde Hacim')).not.toBeInTheDocument()

    // pre-existing sections rendered their own successful data
    await waitFor(() => expect(within(getSummaryCard()).getByText('Açık')).toBeInTheDocument())
    expect(screen.getByText('%87')).toBeInTheDocument()
    expect(screen.getByText('IT')).toBeInTheDocument()
  })

  // AC5: all-zero categorical dataset shows the "Henüz veri yok" empty state instead of a chart
  it('shows "Henüz veri yok" for a categorical section whose counts are all zero', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          makeDistribution({
            status: [
              { status: 'OPEN', count: 0 },
              { status: 'ASSIGNED', count: 0 },
            ],
          }),
        ),
      )

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Durum Dağılımı')).toBeInTheDocument())
    const statusCard = getCardByTitle('Durum Dağılımı')
    await waitFor(() => expect(within(statusCard).getByText('Henüz veri yok')).toBeInTheDocument())
    expect(within(statusCard).queryByText('Açık')).not.toBeInTheDocument()
  })

  // AC5: all-zero volume-over-time dataset shows its own distinct empty-state text
  it('shows "Bu aralıkta veri yok" for the volume chart when all counts are zero', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          makeDistribution({
            volumeOverTime: [
              { date: '2026-09-01', count: 0 },
              { date: '2026-09-02', count: 0 },
            ],
          }),
        ),
      )

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Zaman İçinde Hacim')).toBeInTheDocument())
    const volumeCard = getCardByTitle('Zaman İçinde Hacim')
    await waitFor(() =>
      expect(within(volumeCard).getByText('Bu aralıkta veri yok')).toBeInTheDocument(),
    )
  })

  // AC6: while the distribution fetch is pending, chart sections show "Yükleniyor..."
  it('shows "Yükleniyor..." for the distribution sections before data resolves', async () => {
    let resolveDistribution: (value: Response) => void = () => {}
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(200, makeSummary()))
      .mockResolvedValueOnce(jsonResponse(200, makeSla()))
      .mockResolvedValueOnce(jsonResponse(200, makeWorkload()))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveDistribution = resolve
        }),
      )

    renderAnalytics()

    await waitFor(() => expect(screen.getByText('Durum Dağılımı')).toBeInTheDocument())
    const statusCard = getCardByTitle('Durum Dağılımı')
    expect(within(statusCard).getByText('Yükleniyor...')).toBeInTheDocument()

    resolveDistribution(jsonResponse(200, makeDistribution()))
    await waitFor(() => expect(within(statusCard).queryByText('Yükleniyor...')).not.toBeInTheDocument())
  })
})
