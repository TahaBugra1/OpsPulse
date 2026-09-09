// Notification bell data layer: types and TanStack Query hooks (unread
// count, latest-20 list, mark one/all read).

import { useMutation, useQuery } from '@tanstack/react-query'
import { apiGet, apiPatch } from './api'

export interface AppNotification {
  id: string
  user_id: string
  request_id: string | null
  type: 'REQUEST_ASSIGNED' | 'REQUEST_COMPLETED' | 'REQUEST_REJECTED' | 'COMMENT_ADDED'
  message: string
  read_at: string | null
  created_at: string
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiGet<{ count: number }>('/api/notifications/unread-count'),
  })
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGet<AppNotification[]>('/api/notifications'),
    enabled,
  })
}

export function useMarkAsRead() {
  return useMutation({
    mutationFn: (id: string) => apiPatch<unknown>(`/api/notifications/${id}/read`),
  })
}

export function useMarkAllAsRead() {
  return useMutation({
    mutationFn: () => apiPatch<unknown>('/api/notifications/read-all'),
  })
}
