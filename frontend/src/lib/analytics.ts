// Analytics data layer: read-only TanStack Query hooks for the summary,
// SLA, and department workload endpoints (no mutations — nothing here
// writes anything).

import { useQuery } from '@tanstack/react-query'
import { apiGet } from './api'

export interface AnalyticsSummary {
  total_open: number
  total_assigned: number
  total_in_progress: number
  total_completed: number
  total_rejected: number
  total_overdue: number
}

export interface SlaMetrics {
  compliance_rate: number
  avg_resolution_hours: number | null
}

export interface DepartmentWorkload {
  department_name: string
  open: number
  assigned: number
  in_progress: number
  completed: number
  rejected: number
}

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => apiGet<AnalyticsSummary>('/api/analytics/summary'),
  })
}

export function useAnalyticsSla() {
  return useQuery({
    queryKey: ['analytics', 'sla'],
    queryFn: () => apiGet<SlaMetrics>('/api/analytics/sla'),
  })
}

export function useAnalyticsWorkload() {
  return useQuery({
    queryKey: ['analytics', 'workload'],
    queryFn: () => apiGet<DepartmentWorkload[]>('/api/analytics/workload'),
  })
}
