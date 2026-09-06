import { PackageOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAnalyticsSla, useAnalyticsSummary, useAnalyticsWorkload } from '@/lib/analytics'
import { STATUS_LABELS } from '@/lib/requests'

export default function Analytics() {
  const summaryQuery = useAnalyticsSummary()
  const slaQuery = useAnalyticsSla()
  const workloadQuery = useAnalyticsWorkload()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Genel Bakış</h1>

      <Card>
        <CardHeader>
          <CardTitle>Durum Özeti</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {summaryQuery.isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {summaryQuery.error instanceof Error
                  ? summaryQuery.error.message
                  : 'Özet verisi yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => summaryQuery.refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!summaryQuery.isPending && !summaryQuery.isError && summaryQuery.data && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{STATUS_LABELS.OPEN}</span>
                <span className="text-2xl font-semibold">{summaryQuery.data.total_open}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{STATUS_LABELS.ASSIGNED}</span>
                <span className="text-2xl font-semibold">{summaryQuery.data.total_assigned}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{STATUS_LABELS.IN_PROGRESS}</span>
                <span className="text-2xl font-semibold">{summaryQuery.data.total_in_progress}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{STATUS_LABELS.COMPLETED}</span>
                <span className="text-2xl font-semibold">{summaryQuery.data.total_completed}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{STATUS_LABELS.REJECTED}</span>
                <span className="text-2xl font-semibold">{summaryQuery.data.total_rejected}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Gecikmiş</span>
                <span className="text-2xl font-semibold">{summaryQuery.data.total_overdue}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SLA Performansı</CardTitle>
        </CardHeader>
        <CardContent>
          {slaQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {slaQuery.isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {slaQuery.error instanceof Error
                  ? slaQuery.error.message
                  : 'SLA verisi yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => slaQuery.refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!slaQuery.isPending && !slaQuery.isError && slaQuery.data && (
            <>
              {slaQuery.data.avg_resolution_hours === null ? (
                <p className="text-muted-foreground">Henüz tamamlanmış talep yok</p>
              ) : (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <dt className="text-muted-foreground">SLA Uyum Oranı</dt>
                  <dd>%{slaQuery.data.compliance_rate}</dd>
                  <dt className="text-muted-foreground">Ortalama Çözüm Süresi</dt>
                  <dd>{slaQuery.data.avg_resolution_hours} saat</dd>
                </dl>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Departman İş Yükü</CardTitle>
        </CardHeader>
        <CardContent>
          {workloadQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {workloadQuery.isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {workloadQuery.error instanceof Error
                  ? workloadQuery.error.message
                  : 'İş yükü verisi yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => workloadQuery.refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!workloadQuery.isPending && !workloadQuery.isError && workloadQuery.data && workloadQuery.data.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Henüz departman verisi yok</p>
            </div>
          )}

          {!workloadQuery.isPending && !workloadQuery.isError && workloadQuery.data && workloadQuery.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Departman</TableHead>
                  <TableHead>{STATUS_LABELS.OPEN}</TableHead>
                  <TableHead>{STATUS_LABELS.ASSIGNED}</TableHead>
                  <TableHead>{STATUS_LABELS.IN_PROGRESS}</TableHead>
                  <TableHead>{STATUS_LABELS.COMPLETED}</TableHead>
                  <TableHead>{STATUS_LABELS.REJECTED}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workloadQuery.data.map((row) => (
                  <TableRow key={row.department_name}>
                    <TableCell>{row.department_name}</TableCell>
                    <TableCell>{row.open}</TableCell>
                    <TableCell>{row.assigned}</TableCell>
                    <TableCell>{row.in_progress}</TableCell>
                    <TableCell>{row.completed}</TableCell>
                    <TableCell>{row.rejected}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
