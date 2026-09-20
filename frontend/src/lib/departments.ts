import { useMutation, useQuery } from '@tanstack/react-query'
import { AUTH_DEPARTMENTS_PATH, apiGet, apiPatch, apiPost } from './api'

export interface Department {
  id: string
  name: string
  is_active: boolean
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => apiGet<Department[]>('/api/departments'),
  })
}

/** Unauthenticated department list, for the register form (no token yet).
 *  Backed by listActiveDepartments(), which only ever returns {id, name} —
 *  no is_active — so this is typed narrower than Department on purpose. */
export function usePublicDepartments() {
  return useQuery({
    queryKey: ['public-departments'],
    queryFn: () => apiGet<Pick<Department, 'id' | 'name'>[]>(AUTH_DEPARTMENTS_PATH),
  })
}

export function useCreateDepartment() {
  return useMutation({
    mutationFn: (body: { name: string }) => apiPost<Department>('/api/departments', body),
  })
}

export function useUpdateDepartment(id: string) {
  return useMutation({
    mutationFn: (body: { name: string }) => apiPatch<Department>(`/api/departments/${id}`, body),
  })
}

export function useDeactivateDepartment() {
  return useMutation({
    mutationFn: (id: string) => apiPatch<Department>(`/api/departments/${id}/deactivate`),
  })
}

export function useActivateDepartment() {
  return useMutation({
    mutationFn: (id: string) => apiPatch<Department>(`/api/departments/${id}/activate`),
  })
}
