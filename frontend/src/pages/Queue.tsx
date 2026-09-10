import { zodResolver } from '@hookform/resolvers/zod'
import { PackageOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useSocket } from '@/context/SocketContext'
import { ApiError } from '@/lib/api'
import {
  getSlaDisplay,
  PRIORITY_LABELS,
  type BulkQueueActionResult,
  type RequestListItem,
  type SlaTone,
  useBulkQueueAction,
  useClaimRequest,
  useOpenQueue,
  useRequestTypes,
} from '@/lib/requests'
import { rejectNoteSchema, type RejectNoteFormValues } from '@/lib/validation'

const SLA_TONE_CLASSES: Record<SlaTone, string> = {
  normal: 'text-muted-foreground',
  warning: 'text-warning',
  overdue: 'text-destructive',
}

const SAVED_FILTERS_KEY = 'opspulse_queue_saved_filters'

interface SavedFilter {
  name: string
  q: string
  request_type_id: string
  priority: string
  date_from: string
  date_to: string
}

function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(SAVED_FILTERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persistSavedFilters(filters: SavedFilter[]): void {
  try {
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(filters))
  } catch {
    // private-browsing/storage-full: non-critical convenience feature, ignore.
  }
}

// A bulk run reports successes and failures separately, and tells a 409
// ("someone else already took it") apart from any other error.
function bulkSummary(action: 'CLAIM' | 'REJECT', result: BulkQueueActionResult) {
  const parts = [`${result.succeeded} talep ${action === 'CLAIM' ? 'üstlenildi' : 'reddedildi'}`]
  if (result.conflicted > 0) parts.push(`${result.conflicted} talep başkası tarafından alınmış`)
  if (result.failed > 0) parts.push(`${result.failed} talep başarısız oldu`)
  return parts.join(', ')
}

export default function Queue() {
  const { user } = useAuth()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data: requestTypes } = useRequestTypes()
  const canClaim = user?.role === 'DEPARTMENT_AUTHORITY'

  const [searchParams, setSearchParams] = useSearchParams()
  const requestTypeId = searchParams.get('request_type_id') ?? ''
  const priority = searchParams.get('priority') ?? ''
  const dateFrom = searchParams.get('date_from') ?? ''
  const dateTo = searchParams.get('date_to') ?? ''
  const urlQ = searchParams.get('q') ?? ''

  const [qInput, setQInput] = useState(urlQ)
  const [debouncedQ, setDebouncedQ] = useState(urlQ)

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQ(qInput)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (qInput) next.set('q', qInput)
          else next.delete('q')
          return next
        },
        { replace: true },
      )
    }, 300)

    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput])

  const visibleRequestTypes =
    user?.role === 'DEPARTMENT_AUTHORITY'
      ? requestTypes?.filter((requestType) => requestType.department_id === user.department_id)
      : requestTypes

  const dateRangeError = !!(dateFrom && dateTo && dateFrom > dateTo)
  const filters = {
    q: debouncedQ,
    request_type_id: requestTypeId,
    priority,
    date_from: dateRangeError ? '' : dateFrom,
    date_to: dateRangeError ? '' : dateTo,
  }
  const { data, isPending, isError, error, refetch } = useOpenQueue(filters)
  const queueKey = ['requests', 'queue', debouncedQ, requestTypeId, priority, filters.date_from, filters.date_to]
  const hasActiveFilters = !!(debouncedQ || requestTypeId || priority || dateFrom || dateTo)

  const bulkMutation = useBulkQueueAction()
  const [selection, setSelection] = useState<string[]>([])
  const [rejectOpen, setRejectOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => loadSavedFilters())
  const [saveNameInput, setSaveNameInput] = useState('')

  const rejectForm = useForm<RejectNoteFormValues>({
    resolver: zodResolver(rejectNoteSchema),
    defaultValues: { note: '' },
  })

  // The selection is derived against the rows currently rendered, so an id can
  // never linger after its row leaves the queue - whether it left via the
  // request:removedFromQueue socket event, a filter change, or a refetch.
  const selectedIds = selection.filter((id) => data?.some((request) => request.id === id))

  function handleToggleRow(id: string) {
    setSelection((prev) =>
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id],
    )
  }

  function handleToggleAll() {
    setSelection(
      selectedIds.length === data?.length ? [] : (data?.map((request) => request.id) ?? []),
    )
  }

  function runBulkAction(action: 'CLAIM' | 'REJECT', note?: string) {
    bulkMutation.mutate(
      { ids: selectedIds, action, note },
      {
        onSuccess: (result) => {
          const message = bulkSummary(action, result)
          if (result.conflicted + result.failed > 0) toast.error(message)
          else toast.success(message)
          setSelection([])
          setRejectOpen(false)
          rejectForm.reset({ note: '' })
          queryClient.invalidateQueries({ queryKey: queueKey })
        },
      },
    )
  }

  function handleRequestTypeChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('request_type_id', value)
      else next.delete('request_type_id')
      return next
    })
  }

  function handlePriorityChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('priority', value)
      else next.delete('priority')
      return next
    })
  }

  function handleDateFromChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('date_from', value)
      else next.delete('date_from')
      return next
    })
  }

  function handleDateToChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('date_to', value)
      else next.delete('date_to')
      return next
    })
  }

  function handleClearFilters() {
    setQInput('')
    setDebouncedQ('')
    setSearchParams({})
  }

  function handleSaveFilter() {
    const name = saveNameInput.trim()
    if (!name) return

    const newFilter: SavedFilter = {
      name,
      q: debouncedQ,
      request_type_id: requestTypeId,
      priority,
      date_from: dateFrom,
      date_to: dateTo,
    }
    const existingIndex = savedFilters.findIndex((filter) => filter.name === name)
    const next =
      existingIndex === -1
        ? [...savedFilters, newFilter]
        : savedFilters.map((filter, index) => (index === existingIndex ? newFilter : filter))

    persistSavedFilters(next)
    setSavedFilters(next)
    setSaveNameInput('')
  }

  function handleApplySavedFilter(name: string) {
    const filter = savedFilters.find((savedFilter) => savedFilter.name === name)
    if (!filter) return

    setSearchParams(() => {
      const next = new URLSearchParams()
      if (filter.q) next.set('q', filter.q)
      if (filter.request_type_id) next.set('request_type_id', filter.request_type_id)
      if (filter.priority) next.set('priority', filter.priority)
      if (filter.date_from) next.set('date_from', filter.date_from)
      if (filter.date_to) next.set('date_to', filter.date_to)
      return next
    })
    setQInput(filter.q)
    setDebouncedQ(filter.q)
  }

  useEffect(() => {
    if (!socket) return

    function handleRemoved(payload: { id: string }) {
      queryClient.setQueryData(queueKey, (old: RequestListItem[] | undefined) =>
        old?.filter((request) => request.id !== payload.id),
      )
    }

    // useOpenQueue()'s raw cache holds the backend's `created_at DESC` order and
    // only flips it to oldest-first FIFO at read time via `select`, so a newly
    // created (= newest) request must be prepended here to render last.
    function handleAdded(payload: RequestListItem) {
      queryClient.setQueryData(queueKey, (old: RequestListItem[] | undefined) => {
        if (!old) return [payload]
        if (old.some((request) => request.id === payload.id)) return old
        return [payload, ...old]
      })
    }

    socket.on('request:removedFromQueue', handleRemoved)
    socket.on('request:addedToQueue', handleAdded)

    return () => {
      socket.off('request:removedFromQueue', handleRemoved)
      socket.off('request:addedToQueue', handleAdded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, queryClient, debouncedQ, requestTypeId, priority, filters.date_from, filters.date_to])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Kuyruk</h1>
      <Card className="w-full">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-search" className="text-sm font-medium">
                Ara
              </label>
              <Input
                id="queue-search"
                type="text"
                placeholder="Başlık veya açıklamada ara"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-request-type" className="text-sm font-medium">
                Talep Tipi
              </label>
              <Select
                id="queue-request-type"
                value={requestTypeId}
                onChange={handleRequestTypeChange}
              >
                <option value="">Tümü</option>
                {visibleRequestTypes?.map((requestType) => (
                  <option key={requestType.id} value={requestType.id}>
                    {requestType.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-priority" className="text-sm font-medium">
                Öncelik
              </label>
              <Select
                id="queue-priority"
                value={priority}
                onChange={handlePriorityChange}
              >
                <option value="">Tümü</option>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-date-from" className="text-sm font-medium">
                Başlangıç Tarihi
              </label>
              <Input
                id="queue-date-from"
                type="date"
                value={dateFrom}
                onChange={handleDateFromChange}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-date-to" className="text-sm font-medium">
                Bitiş Tarihi
              </label>
              <Input id="queue-date-to" type="date" value={dateTo} onChange={handleDateToChange} />
            </div>
            {hasActiveFilters && (
              <Button type="button" variant="outline" onClick={handleClearFilters}>
                Filtreleri Temizle
              </Button>
            )}
          </div>

          {dateRangeError && (
            <p role="alert" className="text-sm font-normal text-destructive">
              Başlangıç tarihi bitiş tarihinden sonra olamaz
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-saved-filter" className="text-sm font-medium">
                Kayıtlı Filtreler
              </label>
              <Select
                id="queue-saved-filter"
                value=""
                onChange={(event) => handleApplySavedFilter(event.target.value)}
              >
                <option value="">Kayıtlı filtre seç</option>
                {savedFilters.map((filter) => (
                  <option key={filter.name} value={filter.name}>
                    {filter.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="queue-save-filter-name" className="text-sm font-medium">
                Yeni Filtre Adı
              </label>
              <Input
                id="queue-save-filter-name"
                type="text"
                placeholder="Filtre adı"
                value={saveNameInput}
                onChange={(event) => setSaveNameInput(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleSaveFilter}
              disabled={!saveNameInput.trim()}
            >
              Bu Filtreyi Kaydet
            </Button>
          </div>

          {canClaim && selectedIds.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{selectedIds.length} talep seçildi</p>
              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={() => runBulkAction('CLAIM')}
                  disabled={bulkMutation.isPending}
                >
                  Seçilenleri Üstlen
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setRejectOpen(true)}
                  disabled={bulkMutation.isPending}
                >
                  Seçilenleri Reddet
                </Button>
              </div>
            </div>
          )}

          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Kuyruk yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && data && data.length === 0 && hasActiveFilters && (
            <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Bu filtrelere uyan talep yok</p>
              <Button type="button" variant="outline" onClick={handleClearFilters}>
                Filtreleri Temizle
              </Button>
            </div>
          )}

          {!isPending && !isError && data && data.length === 0 && !hasActiveFilters && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Kuyrukta talep yok</p>
            </div>
          )}

          {!isPending && !isError && data && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  {canClaim && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Tümünü seç"
                        checked={selectedIds.length === data.length}
                        indeterminate={selectedIds.length > 0 && selectedIds.length < data.length}
                        onCheckedChange={handleToggleAll}
                      />
                    </TableHead>
                  )}
                  <TableHead>No</TableHead>
                  <TableHead>Başlık</TableHead>
                  <TableHead>Öncelik</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead>Oluşturulma Tarihi</TableHead>
                  {canClaim && <TableHead>Aksiyon</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((request) => (
                  <QueueRow
                    key={request.id}
                    request={request}
                    canClaim={canClaim}
                    queueKey={queueKey}
                    selected={selectedIds.includes(request.id)}
                    onToggleSelect={handleToggleRow}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canClaim && (
        <Dialog open={rejectOpen} onOpenChange={(open) => setRejectOpen(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Seçilen Talepleri Reddet</DialogTitle>
              <DialogDescription>
                {selectedIds.length} talep aynı red sebebiyle reddedilecek.
              </DialogDescription>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={rejectForm.handleSubmit((values) => runBulkAction('REJECT', values.note))}
              noValidate
            >
              <Controller
                control={rejectForm.control}
                name="note"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="bulk-reject-note">Red Sebebi</FieldLabel>
                    <Input
                      {...field}
                      id="bulk-reject-note"
                      disabled={bulkMutation.isPending}
                      aria-invalid={!!fieldState.error}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                  </Field>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRejectOpen(false)}
                  disabled={bulkMutation.isPending}
                >
                  Vazgeç
                </Button>
                <Button type="submit" variant="destructive" disabled={bulkMutation.isPending}>
                  Reddet
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function QueueRow({
  request,
  canClaim,
  queueKey,
  selected,
  onToggleSelect,
}: {
  request: RequestListItem
  canClaim: boolean
  queueKey: readonly unknown[]
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const claimMutation = useClaimRequest(request.id)
  const sla = getSlaDisplay(request)

  function handleClaim() {
    claimMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queueKey })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          queryClient.invalidateQueries({ queryKey: queueKey })
        }
      },
    })
  }

  return (
    <TableRow>
      {canClaim && (
        <TableCell>
          <Checkbox
            aria-label={`#${request.request_number} seç`}
            checked={selected}
            onCheckedChange={() => onToggleSelect(request.id)}
          />
        </TableCell>
      )}
      <TableCell>#{request.request_number}</TableCell>
      <TableCell>{request.title}</TableCell>
      <TableCell>{PRIORITY_LABELS[request.priority] ?? request.priority}</TableCell>
      <TableCell className={sla ? SLA_TONE_CLASSES[sla.tone] : undefined}>
        {sla?.label ?? '-'}
      </TableCell>
      <TableCell>{request.department_name}</TableCell>
      <TableCell>{new Date(request.created_at).toLocaleString('tr-TR')}</TableCell>
      {canClaim && (
        <TableCell>
          <Button type="button" size="sm" onClick={handleClaim} disabled={claimMutation.isPending}>
            Üstlen
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}
