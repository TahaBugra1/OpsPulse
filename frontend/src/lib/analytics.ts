// Analytics data layer: read-only TanStack Query hooks for the summary,
// SLA, department workload, distribution, and bottlenecks endpoints (no
// mutations — nothing here writes anything).

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

export function useEmployeeSummary() {
  return useQuery({
    queryKey: ['analytics', 'my-summary'],
    queryFn: () => apiGet<AnalyticsSummary>('/api/analytics/my-summary'),
  })
}

export function useEmployeeSla() {
  return useQuery({
    queryKey: ['analytics', 'my-sla'],
    queryFn: () => apiGet<SlaMetrics>('/api/analytics/my-sla'),
  })
}

export function useAnalyticsWorkload() {
  return useQuery({
    queryKey: ['analytics', 'workload'],
    queryFn: () => apiGet<DepartmentWorkload[]>('/api/analytics/workload'),
  })
}

export interface DistributionData {
  status: { status: string; count: number }[]
  priority: { priority: string; count: number }[]
  department: { department: string; count: number }[]
  requestType: { requestType: string; count: number }[]
  volumeOverTime: { date: string; count: number }[]
}

export function useAnalyticsDistribution(days: number) {
  return useQuery({
    queryKey: ['analytics', 'distribution', days],
    queryFn: () => apiGet<DistributionData>(`/api/analytics/distribution?days=${days}`),
  })
}

export interface BottlenecksData {
  slaBreachByDepartment: { department: string; count: number }[]
  slaBreachByRequestType: { requestType: string; count: number }[]
  stageDurations: { stage: string; avg_hours: number | null }[]
  authorityWorkload: { authority_name: string; department_name: string; active_count: number }[]
}

export const STAGE_LABELS: Record<string, string> = {
  OPEN_TO_ASSIGNED: 'Açık → Atandı',
  ASSIGNED_TO_IN_PROGRESS: 'Atandı → İşlemde',
  IN_PROGRESS_TO_COMPLETED: 'İşlemde → Tamamlandı',
}

export function useAnalyticsBottlenecks() {
  return useQuery({
    queryKey: ['analytics', 'bottlenecks'],
    queryFn: () => apiGet<BottlenecksData>('/api/analytics/bottlenecks'),
    select: (data) => ({
      ...data,
      stageDurations: [...data.stageDurations].sort(
        (a, b) => (b.avg_hours ?? -1) - (a.avg_hours ?? -1),
      ),
    }),
  })
}
