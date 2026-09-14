import { useQuery } from '@tanstack/react-query'
import { AUTH_DEPARTMENTS_PATH, apiGet } from './api'

export interface Department {
  id: string
  name: string
}

export function useDepartments() {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => apiGet<Department[]>('/api/departments'),
  })
}

/** Unauthenticated department list, for the register form (no token yet). */
export function usePublicDepartments() {
  return useQuery({
    queryKey: ['public-departments'],
    queryFn: () => apiGet<Department[]>(AUTH_DEPARTMENTS_PATH),
  })
}
