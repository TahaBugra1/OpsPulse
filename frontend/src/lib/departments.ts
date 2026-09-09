import { useQuery } from '@tanstack/react-query'
import { apiGet } from './api'

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
