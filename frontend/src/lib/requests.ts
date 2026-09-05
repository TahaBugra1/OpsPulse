// Request list/detail data layer: types, Turkish label mappings, and
// TanStack Query hooks (reads plus the request creation/claim/status/
// priority/comment mutations).

import { useMutation, useQuery } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from './api'

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
  author_name: string
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

export function useRequests() {
  return useQuery({
    queryKey: ['requests'],
    queryFn: () => apiGet<RequestListItem[]>('/api/requests'),
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
