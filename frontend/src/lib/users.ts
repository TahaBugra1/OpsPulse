import { useMutation, useQuery } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from './api'

export interface UserProfile {
  id: string
  name: string
  surname: string | null
  email: string
  role: 'EMPLOYEE' | 'DEPARTMENT_AUTHORITY' | 'ADMIN'
  department_id: string | null
  department_name: string | null
}

export const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: 'Çalışan',
  DEPARTMENT_AUTHORITY: 'Departman Yetkilisi',
  ADMIN: 'Yönetici',
}

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => apiGet<UserProfile>('/api/users/me'),
  })
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (body: { name: string; surname: string | null }) =>
      apiPatch<UserProfile>('/api/users/me', body),
  })
}

export interface AdminUserListItem {
  id: string
  name: string
  surname: string | null
  email: string
  role: 'EMPLOYEE' | 'DEPARTMENT_AUTHORITY' | 'ADMIN'
  department_id: string | null
  department_name: string | null
  is_active: boolean
  created_at: string
}

export function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiGet<AdminUserListItem[]>('/api/users'),
  })
}

export function useCreateDepartmentAuthority() {
  return useMutation({
    mutationFn: (body: { name: string; surname: string; email: string; password: string; department_id: string }) =>
      apiPost<AdminUserListItem>('/api/users', body),
  })
}

export function useDeactivateUser() {
  return useMutation({
    mutationFn: (id: string) => apiPatch<unknown>(`/api/users/${id}/deactivate`),
  })
}
