import { useMutation, useQuery } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from './api'
import type { AuthUser } from './authStorage'

export interface UserProfile {
  id: string
  name: string
  surname: string | null
  email: string
  role: 'EMPLOYEE' | 'DEPARTMENT_AUTHORITY' | 'ADMIN'
  department_id: string | null
  department_name: string | null
  has_password: boolean
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

export function useCompleteDepartment() {
  return useMutation({
    mutationFn: (body: { department_id: string }) =>
      apiPatch<UserProfile>('/api/users/me/department', body),
  })
}

export function useChangeMyPassword() {
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      apiPatch<AuthUser>('/api/users/me/password', body),
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
  has_password: boolean
}

export function useUsers() {
  return useQuery({
    queryKey: ['admin-users'],
    queryFn: () => apiGet<AdminUserListItem[]>('/api/users'),
  })
}

export interface TeamMember {
  id: string
  name: string
  surname: string | null
  email: string
  is_active: boolean
}

export function useMyTeam() {
  return useQuery({
    queryKey: ['my-team'],
    queryFn: () => apiGet<TeamMember[]>('/api/users/team'),
  })
}

export function useCreateUser() {
  return useMutation({
    mutationFn: (body: { name: string; surname: string; email: string; role: string; department_id: string }) =>
      apiPost<{ temporary_password: string }>('/api/users', body),
  })
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: (id: string) => apiPost<{ temporary_password: string }>(`/api/users/${id}/reset-password`),
  })
}

export function useDeactivateUser() {
  return useMutation({
    mutationFn: (id: string) => apiPatch<unknown>(`/api/users/${id}/deactivate`),
  })
}
