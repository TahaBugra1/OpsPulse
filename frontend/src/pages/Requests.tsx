import { useEffect, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  getSlaDisplay,
  PRIORITY_LABELS,
  REQUESTS_PAGE_TITLE,
  type SlaTone,
  STATUS_LABELS,
  useRequests,
  useRequestTypes,
} from '@/lib/requests'

const SLA_TONE_CLASSES: Record<SlaTone, string> = {
  normal: 'text-muted-foreground',
  warning: 'text-warning',
  overdue: 'text-destructive',
}

export default function Requests() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: requestTypes } = useRequestTypes()

  const [searchParams, setSearchParams] = useSearchParams()
  const status = searchParams.get('status') ?? ''
  const requestTypeId = searchParams.get('request_type_id') ?? ''
  const priority = searchParams.get('priority') ?? ''
  const assignedToMe = searchParams.get('assigned_to_me') === 'true'
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

  const filters = { q: debouncedQ, status, request_type_id: requestTypeId, priority, assigned_to_me: assignedToMe }
  const { data, isPending, isError, error, refetch } = useRequests(filters)
  const hasActiveFilters = !!(debouncedQ || status || requestTypeId || priority || assignedToMe)

  function handleStatusChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('status', value)
      else next.delete('status')
      return next
    })
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

  function handleAssignedToMeChange(checked: boolean) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (checked) {
        // Backend's assigned_to_me filter always scopes to ASSIGNED/IN_PROGRESS
        // itself and ignores a separately-sent status param, so clear it here to
        // keep the UI (and the disabled Durum dropdown) consistent with that.
        next.set('assigned_to_me', 'true')
        next.delete('status')
      } else {
        next.delete('assigned_to_me')
      }
      return next
    })
  }

  function handleClearFilters() {
    setQInput('')
    setDebouncedQ('')
    setSearchParams({})
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{REQUESTS_PAGE_TITLE[user!.role] ?? 'Talepler'}</h1>
        {user!.role !== 'ADMIN' && (
          <Button type="button" onClick={() => navigate('/requests/new')}>
            Yeni Talep
          </Button>
        )}
      </div>
      <Card className="w-full">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="requests-search" className="text-sm font-medium">
                Ara
              </label>
              <Input
                id="requests-search"
                type="text"
                placeholder="Başlık veya açıklamada ara"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="requests-status" className="text-sm font-medium">
                Durum
              </label>
              <Select
                id="requests-status"
                value={status}
                onChange={handleStatusChange}
                disabled={assignedToMe}
              >
                <option value="">Tümü</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="requests-request-type" className="text-sm font-medium">
                Talep Tipi
              </label>
              <Select
                id="requests-request-type"
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
              <label htmlFor="requests-priority" className="text-sm font-medium">
                Öncelik
              </label>
              <Select
                id="requests-priority"
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
            {user?.role === 'DEPARTMENT_AUTHORITY' && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="requests-assigned-to-me"
                  checked={assignedToMe}
                  onCheckedChange={handleAssignedToMeChange}
                />
                <label htmlFor="requests-assigned-to-me" className="text-sm font-medium">
                  Bana Atananlar
                </label>
              </div>
            )}
            {hasActiveFilters && (
              <Button type="button" variant="outline" onClick={handleClearFilters}>
                Filtreleri Temizle
              </Button>
            )}
          </div>

          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Talepler yüklenemedi, lütfen tekrar deneyin'}
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
              <p>Henüz talep yok</p>
            </div>
          )}

          {!isPending && !isError && data && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Başlık</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Öncelik</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead>Oluşturulma Tarihi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((request) => {
                  const sla = getSlaDisplay(request)

                  return (
                    <TableRow
                      key={request.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/requests/${request.id}`)}
                      tabIndex={0}
                      role="link"
                      aria-label={`${request.title} talebini görüntüle`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          if (event.key === ' ') {
                            event.preventDefault()
                          }
                          navigate(`/requests/${request.id}`)
                        }
                      }}
                    >
                      <TableCell>#{request.request_number}</TableCell>
                      <TableCell>{request.title}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline">{STATUS_LABELS[request.status] ?? request.status}</Badge>
                          {request.is_overdue && <Badge variant="destructive">Gecikmiş</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{PRIORITY_LABELS[request.priority] ?? request.priority}</TableCell>
                      <TableCell className={sla ? SLA_TONE_CLASSES[sla.tone] : undefined}>
                        {sla?.label ?? '-'}
                      </TableCell>
                      <TableCell>{request.department_name}</TableCell>
                      <TableCell>{new Date(request.created_at).toLocaleString('tr-TR')}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
