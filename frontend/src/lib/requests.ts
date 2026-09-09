// Request list/detail data layer: types, Turkish label mappings, and
// TanStack Query hooks (reads plus the request creation/claim/status/
// priority/comment mutations, the open-requests queue read, and the queue's
// bulk claim/reject mutation).

import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from './api'

export interface RequestListItem {
  id: string
  request_number: number
  title: string
  description: string
  request_type_id: string
  department_id: string
  created_by: string
  assigned_to: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'
  sla_due_at: string
  created_at: string
  updated_at: string
  is_overdue: boolean
  request_type_name: string
  department_name: string
  created_by_name: string
  assigned_to_name: string | null
}

export interface RequestType {
  id: string
  name: string
  department_id: string
}

export interface RequestComment {
  id: string
  request_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
  is_deleted: boolean
  author_name: string
}

export interface RequestHistoryEntry {
  id: string
  request_id: string
  actor_id: string
  action: 'CREATED' | 'STATUS_CHANGED' | 'PRIORITY_CHANGED'
  old_value: string | null
  new_value: string | null
  note: string | null
  created_at: string
  actor_name: string
}

export const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Açık',
  ASSIGNED: 'Atandı',
  IN_PROGRESS: 'İşlemde',
  COMPLETED: 'Tamamlandı',
  REJECTED: 'Reddedildi',
}

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
}

export const REQUESTS_PAGE_TITLE: Record<string, string> = {
  EMPLOYEE: 'Taleplerim',
  DEPARTMENT_AUTHORITY: 'Departman Talepleri',
  ADMIN: 'Tüm Talepler',
}

export type SlaTone = 'normal' | 'warning' | 'overdue'

export interface SlaDisplay {
  label: string
  tone: SlaTone
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// Supplies the SLA label + tone; the pages map the tone to a class name, the
// same way STATUS_LABELS supplies a label and no styling.
//
// Whether a request is late is the SERVER's call (`is_overdue`) - the client
// clock can be skewed, so local arithmetic is only ever used to measure how
// far away the deadline is, never to decide which side of it we are on.
// Returns null both for terminal statuses (no deadline left to meet) and for
// an unusable sla_due_at; both render as '-'.
export function getSlaDisplay(request: RequestListItem): SlaDisplay | null {
  if (request.status === 'COMPLETED' || request.status === 'REJECTED') return null
  if (!request.sla_due_at) return null

  const dueAt = new Date(request.sla_due_at).getTime()
  if (Number.isNaN(dueAt)) return null

  const remainingMs = dueAt - Date.now()
  const amountMs = Math.abs(remainingMs)

  let amount: string
  if (amountMs >= DAY_MS) amount = `${Math.floor(amountMs / DAY_MS)} gün`
  else if (amountMs >= HOUR_MS) amount = `${Math.floor(amountMs / HOUR_MS)} saat`
  else if (amountMs >= MINUTE_MS) amount = `${Math.floor(amountMs / MINUTE_MS)} dakika`
  else amount = '1 dakikadan az'

  if (request.is_overdue) return { label: `${amount} gecikti`, tone: 'overdue' }

  // The warning threshold is the last quarter of this request's own SLA
  // window, never a fixed hour count - the backend owns the HIGH/MEDIUM/LOW
  // durations and recomputes sla_due_at when priority changes.
  const windowMs = dueAt - new Date(request.created_at).getTime()
  const tone: SlaTone = remainingMs <= windowMs * 0.25 ? 'warning' : 'normal'
  return { label: `${amount} kaldı`, tone }
}

export interface RequestFilters {
  q?: string
  status?: string
  request_type_id?: string
  priority?: string
  assigned_to_me?: boolean
}

export function useRequests(filters: RequestFilters = {}) {
  const { q, status, request_type_id, priority, assigned_to_me } = filters

  return useQuery({
    queryKey: ['requests', q ?? '', status ?? '', request_type_id ?? '', priority ?? '', assigned_to_me ? 'true' : ''],
    queryFn: () => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status) params.set('status', status)
      if (request_type_id) params.set('request_type_id', request_type_id)
      if (priority) params.set('priority', priority)
      if (assigned_to_me) params.set('assigned_to_me', 'true')
      const query = params.toString()
      return apiGet<RequestListItem[]>(`/api/requests${query ? `?${query}` : ''}`)
    },
  })
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: ['requests', id],
    queryFn: () => apiGet<RequestListItem>(`/api/requests/${id}`),
    enabled: !!id,
  })
}

export function useRequestComments(id: string) {
  return useQuery({
    queryKey: ['requests', id, 'comments'],
    queryFn: () => apiGet<RequestComment[]>(`/api/requests/${id}/comments`),
    enabled: !!id,
  })
}

export function useRequestHistory(id: string) {
  return useQuery({
    queryKey: ['requests', id, 'history'],
    queryFn: () => apiGet<RequestHistoryEntry[]>(`/api/requests/${id}/history`),
    enabled: !!id,
  })
}

export function useRequestTypes() {
  return useQuery({
    queryKey: ['request-types'],
    queryFn: () => apiGet<RequestType[]>('/api/request-types'),
  })
}

export function useCreateRequest() {
  // The real POST response is the raw `requests` row (RETURNING *), narrower
  // than RequestListItem (no *_name/is_overdue fields) — only `id` is relied on.
  return useMutation({
    mutationFn: (body: { title: string; description: string; request_type_id: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' }) =>
      apiPost<RequestListItem>('/api/requests', body),
  })
}

// The four mutations below all return raw DB rows (RETURNING *) without the
// JOIN-derived display fields (*_name, is_overdue, author_name), so nothing
// reads their response — the caller invalidates and refetches the enriched
// GET instead of writing the response into the cache with setQueryData.

export function useClaimRequest(id: string) {
  return useMutation({ mutationFn: () => apiPost<unknown>(`/api/requests/${id}/assign`) })
}

export function useChangeRequestStatus(id: string) {
  return useMutation({
    mutationFn: (body: { status: 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'; note?: string }) =>
      apiPatch<unknown>(`/api/requests/${id}/status`, body),
  })
}

export function useChangePriority(id: string) {
  return useMutation({
    mutationFn: (body: { priority: 'LOW' | 'MEDIUM' | 'HIGH' }) =>
      apiPatch<unknown>(`/api/requests/${id}/priority`, body),
  })
}

export function useAddComment(id: string) {
  return useMutation({
    mutationFn: (body: { content: string }) => apiPost<unknown>(`/api/requests/${id}/comments`, body),
  })
}

export function useUpdateComment(requestId: string, commentId: string) {
  return useMutation({
    mutationFn: (body: { content: string }) =>
      apiPatch<RequestComment>(`/api/requests/${requestId}/comments/${commentId}`, body),
  })
}

export function useDeleteComment(requestId: string, commentId: string) {
  return useMutation({
    mutationFn: () => apiDelete<RequestComment>(`/api/requests/${requestId}/comments/${commentId}`),
  })
}

export interface QueueFilters {
  q?: string
  request_type_id?: string
  priority?: string
  date_from?: string
  date_to?: string
}

export function useOpenQueue(filters: QueueFilters = {}) {
  const { q, request_type_id, priority, date_from, date_to } = filters

  return useQuery({
    queryKey: ['requests', 'queue', q ?? '', request_type_id ?? '', priority ?? '', date_from ?? '', date_to ?? ''],
    queryFn: () => {
      const params = new URLSearchParams({ status: 'OPEN' })
      if (q) params.set('q', q)
      if (request_type_id) params.set('request_type_id', request_type_id)
      if (priority) params.set('priority', priority)
      if (date_from) params.set('date_from', date_from)
      if (date_to) params.set('date_to', date_to)
      return apiGet<RequestListItem[]>(`/api/requests?${params.toString()}`)
    },
    select: (data) => [...data].reverse(),
  })
}

export interface BulkQueueActionResult {
  succeeded: number
  conflicted: number
  failed: number
}

// There is no bulk endpoint by design: this loops the existing per-request
// endpoints one at a time (never in parallel) and swallows each item's error
// so a single failure - typically a 409 from another authority claiming the
// row first - does not stop the remaining ids.
export function useBulkQueueAction() {
  return useMutation({
    mutationFn: async ({
      ids,
      action,
      note,
    }: {
      ids: string[]
      action: 'CLAIM' | 'REJECT'
      note?: string
    }) => {
      const result: BulkQueueActionResult = { succeeded: 0, conflicted: 0, failed: 0 }

      for (const id of ids) {
        try {
          if (action === 'CLAIM') {
            await apiPost<unknown>(`/api/requests/${id}/assign`)
          } else {
            await apiPatch<unknown>(`/api/requests/${id}/status`, { status: 'REJECTED', note })
          }
          result.succeeded += 1
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) result.conflicted += 1
          else result.failed += 1
        }
      }

      return result
    },
  })
}
