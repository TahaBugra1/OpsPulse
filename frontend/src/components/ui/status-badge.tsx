import { Badge } from './badge'
import { STATUS_LABELS } from '@/lib/requests'

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'outline'> = {
  COMPLETED: 'success',
  REJECTED: 'destructive',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{STATUS_LABELS[status] ?? status}</Badge>
}
