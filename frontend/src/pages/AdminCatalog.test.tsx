import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminCatalog from './AdminCatalog'
import type { Department } from '@/lib/departments'
import type { RequestType } from '@/lib/requests'

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

interface RouterState {
  departments: Department[]
  requestTypes: RequestType[]
}

interface RouterOverrides {
  getDepartments?: () => Response | Promise<Response>
  getRequestTypes?: () => Response | Promise<Response>
}

// A small in-memory fake backend, keyed by method+URL, that mutates `state`
// exactly like the real endpoints would. This lets create/edit/deactivate/
// activate tests assert on the request AND observe the resulting refetch
// (triggered by AdminCatalog's queryClient.invalidateQueries calls) without
// hand-sequencing every mockResolvedValueOnce call.
function buildFetchRouter(state: RouterState, overrides: RouterOverrides = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined

    if (method === 'GET' && url.endsWith('/api/departments')) {
      return overrides.getDepartments ? overrides.getDepartments() : jsonResponse(200, state.departments)
    }
    if (method === 'GET' && url.endsWith('/api/request-types/all')) {
      return overrides.getRequestTypes ? overrides.getRequestTypes() : jsonResponse(200, state.requestTypes)
    }
    if (method === 'POST' && url.endsWith('/api/departments')) {
      const created: Department = { id: `dept-new-${state.departments.length + 1}`, name: body.name, is_active: true }
      state.departments = [...state.departments, created]
      return jsonResponse(201, created)
    }
    if (method === 'PATCH' && url.includes('/api/departments/') && url.endsWith('/deactivate')) {
      const id = url.split('/').slice(-2)[0]
      state.departments = state.departments.map((d) => (d.id === id ? { ...d, is_active: false } : d))
      state.requestTypes = state.requestTypes.map((rt) =>
        rt.department_id === id ? { ...rt, is_active: false } : rt,
      )
      return jsonResponse(200, state.departments.find((d) => d.id === id))
    }
    if (method === 'PATCH' && url.includes('/api/departments/') && url.endsWith('/activate')) {
      const id = url.split('/').slice(-2)[0]
      state.departments = state.departments.map((d) => (d.id === id ? { ...d, is_active: true } : d))
      return jsonResponse(200, state.departments.find((d) => d.id === id))
    }
    if (method === 'PATCH' && /\/api\/departments\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() as string
      state.departments = state.departments.map((d) => (d.id === id ? { ...d, name: body.name } : d))
      return jsonResponse(200, state.departments.find((d) => d.id === id))
    }
    if (method === 'POST' && url.endsWith('/api/request-types')) {
      const created: RequestType = {
        id: `type-new-${state.requestTypes.length + 1}`,
        name: body.name,
        department_id: body.department_id,
        is_active: true,
      }
      state.requestTypes = [...state.requestTypes, created]
      return jsonResponse(201, created)
    }
    if (method === 'PATCH' && url.includes('/api/request-types/') && url.endsWith('/deactivate')) {
      const id = url.split('/').slice(-2)[0]
      state.requestTypes = state.requestTypes.map((rt) => (rt.id === id ? { ...rt, is_active: false } : rt))
      return jsonResponse(200, state.requestTypes.find((rt) => rt.id === id))
    }
    if (method === 'PATCH' && url.includes('/api/request-types/') && url.endsWith('/activate')) {
      const id = url.split('/').slice(-2)[0]
      state.requestTypes = state.requestTypes.map((rt) => (rt.id === id ? { ...rt, is_active: true } : rt))
      return jsonResponse(200, state.requestTypes.find((rt) => rt.id === id))
    }
    if (method === 'PATCH' && /\/api\/request-types\/[^/]+$/.test(url)) {
      const id = url.split('/').pop() as string
      state.requestTypes = state.requestTypes.map((rt) =>
        rt.id === id ? { ...rt, name: body.name, department_id: body.department_id } : rt,
      )
      return jsonResponse(200, state.requestTypes.find((rt) => rt.id === id))
    }

    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
}

function renderAdminCatalog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminCatalog />
    </QueryClientProvider>,
  )
}

describe('AdminCatalog page', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // Loading state: while departments are pending, both the Departmanlar card
  // AND the Yeni Talep Türü card (which needs the department list for its
  // Select) show the loading message and no request-type creation form is
  // offered — but the Talep Türleri card is independent and still resolves.
  it('shows the loading state for departments, without blocking the independent Talep Türleri card', async () => {
    const state: RouterState = { departments: [], requestTypes: [] }
    vi.stubGlobal(
      'fetch',
      buildFetchRouter(state, { getDepartments: () => new Promise<Response>(() => {}) }),
    )

    renderAdminCatalog()

    expect(await screen.findByText('Henüz talep türü yok')).toBeInTheDocument()
    expect(screen.getAllByText('Yükleniyor...')).toHaveLength(2)
    expect(screen.queryByLabelText('Departman')).not.toBeInTheDocument()
  })

  // Loading state for request types only: once departments resolve, the
  // Talep Türleri card alone stays in its loading state.
  it('shows the loading state for request types only, once departments have resolved', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: true }], requestTypes: [] }
    vi.stubGlobal(
      'fetch',
      buildFetchRouter(state, { getRequestTypes: () => new Promise<Response>(() => {}) }),
    )

    renderAdminCatalog()

    // 'HR' matches both the departments table cell AND the (already loaded)
    // request-type Select's <option>, so scope to role="cell" to stay
    // unambiguous.
    await screen.findByRole('cell', { name: 'HR' })
    expect(screen.getAllByText('Yükleniyor...')).toHaveLength(1)
    expect(screen.getByLabelText('Departman')).toBeInTheDocument()
  })

  // Error state + retry for departments: the SAME error renders in both the
  // Departmanlar card and the Yeni Talep Türü card (both gated on
  // departmentsIsError), and either "Tekrar Dene" button recovers both.
  it('shows a departments error in two places with a working retry', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: true }], requestTypes: [] }
    let failNext = true
    vi.stubGlobal(
      'fetch',
      buildFetchRouter(state, {
        getDepartments: () =>
          failNext
            ? errorResponse(500, 'Departmanlar yüklenemedi, lütfen tekrar deneyin')
            : jsonResponse(200, state.departments),
      }),
    )

    const user = userEvent.setup()
    renderAdminCatalog()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(2)
    for (const alert of alerts) {
      expect(alert).toHaveTextContent('Departmanlar yüklenemedi, lütfen tekrar deneyin')
    }
    const retryButtons = screen.getAllByRole('button', { name: 'Tekrar Dene' })
    expect(retryButtons).toHaveLength(2)

    failNext = false
    await user.click(retryButtons[0])

    // Once departments load, 'HR' is both a table cell and a Select option —
    // scope to role="cell" to stay unambiguous.
    expect(await screen.findByRole('cell', { name: 'HR' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Error state + retry for request types: independent of departments,
  // exactly one alert (Talep Türleri card only).
  it('shows a request types error in one place with a working retry', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: true }], requestTypes: [] }
    let failNext = true
    vi.stubGlobal(
      'fetch',
      buildFetchRouter(state, {
        getRequestTypes: () =>
          failNext
            ? errorResponse(500, 'Talep türleri yüklenemedi, lütfen tekrar deneyin')
            : jsonResponse(200, state.requestTypes),
      }),
    )

    const user = userEvent.setup()
    renderAdminCatalog()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Talep türleri yüklenemedi, lütfen tekrar deneyin')
    // Departments section is unaffected. 'HR' is both a table cell and a
    // Select option, so scope to role="cell" to stay unambiguous.
    expect(screen.getByRole('cell', { name: 'HR' })).toBeInTheDocument()

    failNext = false
    await user.click(screen.getByRole('button', { name: 'Tekrar Dene' }))

    expect(await screen.findByText('Henüz talep türü yok')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Empty states for both tables.
  it('renders "Henüz departman yok" and "Henüz talep türü yok" for empty lists', async () => {
    const state: RouterState = { departments: [], requestTypes: [] }
    vi.stubGlobal('fetch', buildFetchRouter(state))

    renderAdminCatalog()

    expect(await screen.findByText('Henüz departman yok')).toBeInTheDocument()
    expect(await screen.findByText('Henüz talep türü yok')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    // With no departments at all, the request-type creation Select offers
    // only the placeholder.
    const options = within(screen.getByLabelText('Departman')).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Seçiniz'])
  })

  // Rendering both tables with data, including the Aktif/Pasif badges, and
  // proving the create-request-type dropdown only offers ACTIVE departments.
  it('renders both tables with Aktif/Pasif badges and department names, and excludes inactive departments from the dropdown', async () => {
    const state: RouterState = {
      departments: [
        { id: 'dept-1', name: 'HR', is_active: true },
        { id: 'dept-2', name: 'Legacy', is_active: false },
      ],
      requestTypes: [
        { id: 'type-1', name: 'Donanım', department_id: 'dept-1', is_active: true },
        { id: 'type-2', name: 'Eski', department_id: 'dept-2', is_active: false },
      ],
    }
    vi.stubGlobal('fetch', buildFetchRouter(state))

    renderAdminCatalog()

    // 'HR'/'Legacy' each match a departments-table cell, a request-types-table
    // cell (the Donanım/Eski row's department column) and — for the active
    // one — a Select <option>. Scoping to role="cell" and taking the first
    // match (DOM order: the departments table renders before the
    // request-types table) picks the departments-table row reliably.
    const hrRow = (await screen.findAllByRole('cell', { name: 'HR' }))[0].closest('tr') as HTMLElement
    expect(within(hrRow).getByText('Aktif')).toBeInTheDocument()
    const legacyRow = screen.getAllByRole('cell', { name: 'Legacy' })[0].closest('tr') as HTMLElement
    expect(within(legacyRow).getByText('Pasif')).toBeInTheDocument()

    const donanımRow = (await screen.findByText('Donanım')).closest('tr') as HTMLElement
    expect(within(donanımRow).getByText('HR')).toBeInTheDocument()
    expect(within(donanımRow).getByText('Aktif')).toBeInTheDocument()
    const eskiRow = screen.getByText('Eski').closest('tr') as HTMLElement
    expect(within(eskiRow).getByText('Legacy')).toBeInTheDocument()
    expect(within(eskiRow).getByText('Pasif')).toBeInTheDocument()

    const departmentSelect = screen.getByLabelText('Departman')
    expect(within(departmentSelect).getByRole('option', { name: 'HR' })).toBeInTheDocument()
    expect(within(departmentSelect).queryByRole('option', { name: 'Legacy' })).not.toBeInTheDocument()
  })

  // A request type whose department_id doesn't match any known department
  // renders the '-' fallback for its department column.
  it('renders "-" for a request type whose department_id matches no known department', async () => {
    const state: RouterState = {
      departments: [{ id: 'dept-1', name: 'HR', is_active: true }],
      requestTypes: [{ id: 'type-1', name: 'Orphan', department_id: 'dept-missing', is_active: true }],
    }
    vi.stubGlobal('fetch', buildFetchRouter(state))

    renderAdminCatalog()

    const row = (await screen.findByText('Orphan')).closest('tr') as HTMLElement
    expect(within(row).getByText('-')).toBeInTheDocument()
  })

  // AC1: creating a department via the form POSTs and the new row appears
  // after the refetch triggered by invalidateQueries.
  it('creates a department via the form and shows it in the table after refetch', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: true }], requestTypes: [] }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    // 'HR' is both a table cell and a Select option, so scope to role="cell".
    await screen.findByRole('cell', { name: 'HR' })

    await user.type(screen.getByLabelText('Ad', { selector: '#new-department-name' }), 'Legal')
    await user.click(screen.getAllByRole('button', { name: 'Oluştur' })[0])

    const postCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'POST' && String(url).endsWith('/api/departments'),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ name: 'Legal' })

    // The new department shows up as both a table cell and a Select option —
    // scope to role="cell" to stay unambiguous.
    expect(await screen.findByRole('cell', { name: 'Legal' })).toBeInTheDocument()
    // Form resets after success.
    await waitFor(() => expect(screen.getByLabelText('Ad', { selector: '#new-department-name' })).toHaveValue(''))
  })

  // AC2: creating a request type via the form (name + department select)
  // POSTs and the new row appears after refetch. Only active departments are
  // selectable, proven by selecting the only available option.
  it('creates a request type via the form and shows it in the table after refetch', async () => {
    const state: RouterState = {
      departments: [
        { id: 'dept-1', name: 'HR', is_active: true },
        { id: 'dept-2', name: 'Legacy', is_active: false },
      ],
      requestTypes: [],
    }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    // 'HR' is both a table cell and a Select option, so scope to role="cell".
    await screen.findByRole('cell', { name: 'HR' })

    await user.type(screen.getByLabelText('Ad', { selector: '#new-request-type-name' }), 'Yeni Tür')
    await user.selectOptions(screen.getByLabelText('Departman'), 'dept-1')
    await user.click(screen.getAllByRole('button', { name: 'Oluştur' })[1])

    const postCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'POST' && String(url).endsWith('/api/request-types'),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ name: 'Yeni Tür', department_id: 'dept-1' })

    expect(await screen.findByText('Yeni Tür')).toBeInTheDocument()
  })

  // Editing a department: "Düzenle" opens a dialog pre-filled with the
  // current name; submitting PATCHes and the table shows the new name.
  it('edits a department name via the Düzenle dialog', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: true }], requestTypes: [] }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    // 'HR' is both a table cell and a Select option, so scope to role="cell".
    const row = (await screen.findByRole('cell', { name: 'HR' })).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Düzenle' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Ad')).toHaveValue('HR')

    await user.clear(within(dialog).getByLabelText('Ad'))
    await user.type(within(dialog).getByLabelText('Ad'), 'Human Resources')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    const patchCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && /\/api\/departments\/[^/]+$/.test(String(url)),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ name: 'Human Resources' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // The renamed department shows up as both a table cell and a Select
    // option — scope to role="cell" to stay unambiguous.
    expect(await screen.findByRole('cell', { name: 'Human Resources' })).toBeInTheDocument()
  })

  // Editing a request type: dialog pre-filled with name + department;
  // submitting PATCHes with both fields.
  it('edits a request type name and department via the Düzenle dialog', async () => {
    const state: RouterState = {
      departments: [
        { id: 'dept-1', name: 'HR', is_active: true },
        { id: 'dept-2', name: 'IT', is_active: true },
      ],
      requestTypes: [{ id: 'type-1', name: 'Donanım', department_id: 'dept-1', is_active: true }],
    }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    const row = (await screen.findByText('Donanım')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Düzenle' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Ad')).toHaveValue('Donanım')
    expect(within(dialog).getByLabelText('Departman')).toHaveValue('dept-1')

    await user.clear(within(dialog).getByLabelText('Ad'))
    await user.type(within(dialog).getByLabelText('Ad'), 'Donanım Arızası')
    await user.selectOptions(within(dialog).getByLabelText('Departman'), 'dept-2')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    const patchCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && /\/api\/request-types\/[^/]+$/.test(String(url)),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ name: 'Donanım Arızası', department_id: 'dept-2' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const updatedRow = (await screen.findByText('Donanım Arızası')).closest('tr') as HTMLElement
    expect(within(updatedRow).getByText('IT')).toBeInTheDocument()
  })

  // AC6: "Pasife Al" on an active department row deactivates it (no body).
  it('deactivates an active department via Pasife Al', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: true }], requestTypes: [] }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    // 'HR' is both a table cell and a Select option, so scope to role="cell".
    const row = (await screen.findByRole('cell', { name: 'HR' })).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Pasife Al' }))

    const patchCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && String(url).endsWith('/api/departments/dept-1/deactivate'),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(patchCall?.[1]?.body).toBeUndefined()

    await waitFor(() => {
      // Once deactivated, 'HR' also drops out of the Select's active-only
      // option list, but role="cell" stays correct either way.
      const refreshedRow = screen.getByRole('cell', { name: 'HR' }).closest('tr') as HTMLElement
      expect(within(refreshedRow).getByText('Pasif')).toBeInTheDocument()
    })
  })

  // AC8: "Aktifleştir" on an inactive department row activates it (no body).
  it('activates an inactive department via Aktifleştir', async () => {
    const state: RouterState = { departments: [{ id: 'dept-1', name: 'HR', is_active: false }], requestTypes: [] }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    // HR starts inactive, so it's excluded from the Select's option list —
    // the table cell is the only match here.
    const row = (await screen.findByRole('cell', { name: 'HR' })).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Aktifleştir' }))

    const patchCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && String(url).endsWith('/api/departments/dept-1/activate'),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(patchCall?.[1]?.body).toBeUndefined()

    await waitFor(() => {
      // Once activated, 'HR' also reappears in the Select's option list, so
      // scope to role="cell" to stay unambiguous.
      const refreshedRow = screen.getByRole('cell', { name: 'HR' }).closest('tr') as HTMLElement
      expect(within(refreshedRow).getByText('Aktif')).toBeInTheDocument()
    })
  })

  // AC7: "Pasife Al" on an active request type row deactivates only that row.
  it('deactivates an active request type via Pasife Al', async () => {
    const state: RouterState = {
      departments: [{ id: 'dept-1', name: 'HR', is_active: true }],
      requestTypes: [{ id: 'type-1', name: 'Donanım', department_id: 'dept-1', is_active: true }],
    }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    const row = (await screen.findByText('Donanım')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Pasife Al' }))

    const patchCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && String(url).endsWith('/api/request-types/type-1/deactivate'),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(patchCall?.[1]?.body).toBeUndefined()

    await waitFor(() => {
      const refreshedRow = screen.getByText('Donanım').closest('tr') as HTMLElement
      expect(within(refreshedRow).getByText('Pasif')).toBeInTheDocument()
    })
  })

  // AC8: "Aktifleştir" on an inactive request type row activates it.
  it('activates an inactive request type via Aktifleştir', async () => {
    const state: RouterState = {
      departments: [{ id: 'dept-1', name: 'HR', is_active: true }],
      requestTypes: [{ id: 'type-1', name: 'Donanım', department_id: 'dept-1', is_active: false }],
    }
    vi.stubGlobal('fetch', buildFetchRouter(state))
    const user = userEvent.setup()

    renderAdminCatalog()
    const row = (await screen.findByText('Donanım')).closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Aktifleştir' }))

    const patchCall = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && String(url).endsWith('/api/request-types/type-1/activate'),
      )
      expect(call).toBeDefined()
      return call
    })
    expect(patchCall?.[1]?.body).toBeUndefined()

    await waitFor(() => {
      const refreshedRow = screen.getByText('Donanım').closest('tr') as HTMLElement
      expect(within(refreshedRow).getByText('Aktif')).toBeInTheDocument()
    })
  })
})
