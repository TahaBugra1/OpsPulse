import { PackageOpen } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/context/PageTitleContext'
import {
  STAGE_LABELS,
  useAnalyticsBottlenecks,
  useAnalyticsDistribution,
  useAnalyticsSla,
  useAnalyticsSummary,
  useAnalyticsWorkload,
  useEmployeeSla,
  useEmployeeSummary,
} from '@/lib/analytics'
import { PRIORITY_LABELS, STATUS_LABELS } from '@/lib/requests'

// One series per chart, so each config only needs the `count` key. The color
// is read from the theme token — never a literal color in the JSX below.
const STATUS_CHART_CONFIG = {
  count: { label: 'Talep', color: 'var(--chart-1)' },
} satisfies ChartConfig

const PRIORITY_CHART_CONFIG = {
  count: { label: 'Talep', color: 'var(--chart-2)' },
} satisfies ChartConfig

const REQUEST_TYPE_CHART_CONFIG = {
  count: { label: 'Talep', color: 'var(--chart-3)' },
} satisfies ChartConfig

const DEPARTMENT_CHART_CONFIG = {
  count: { label: 'Talep', color: 'var(--chart-4)' },
} satisfies ChartConfig

const VOLUME_CHART_CONFIG = {
  count: { label: 'Talep', color: 'var(--chart-5)' },
} satisfies ChartConfig

const SLA_BREACH_DEPT_CONFIG = {
  count: { label: 'İhlal', color: 'var(--destructive)' },
} satisfies ChartConfig

const SLA_BREACH_TYPE_CONFIG = {
  count: { label: 'İhlal', color: 'var(--destructive)' },
} satisfies ChartConfig

const STAGE_DURATION_CONFIG = {
  avg_hours: { label: 'Saat', color: 'var(--chart-1)' },
} satisfies ChartConfig

export default function Analytics() {
  const { user } = useAuth()

  if (user?.role === 'EMPLOYEE') {
    return <EmployeeAnalytics />
  }

  return <FullAnalytics />
}

function EmployeeAnalytics() {
  const summaryQuery = useEmployeeSummary()
  const slaQuery = useEmployeeSla()
  usePageTitle('Genel Bakış')

  return (
    <div className="flex flex-col gap-4">

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
    </div>
  )
}

function FullAnalytics() {
  const summaryQuery = useAnalyticsSummary()
  const slaQuery = useAnalyticsSla()
  const workloadQuery = useAnalyticsWorkload()

  // `days` is part of the distribution query key, so changing it refetches
  // on its own — no manual refetch() call anywhere.
  const [days, setDays] = useState(30)
  const distributionQuery = useAnalyticsDistribution(days)
  const distribution = distributionQuery.data

  const bottlenecksQuery = useAnalyticsBottlenecks()
  const bottlenecks = bottlenecksQuery.data
  usePageTitle('Genel Bakış')

  return (
    <div className="flex flex-col gap-4">

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

      {distributionQuery.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Dağılımlar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {distributionQuery.error instanceof Error
                  ? distributionQuery.error.message
                  : 'Dağılım verisi yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => distributionQuery.refetch()}>
                Tekrar Dene
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!distributionQuery.isError && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Durum Dağılımı</CardTitle>
            </CardHeader>
            <CardContent>
              {distributionQuery.isPending && (
                <p className="text-muted-foreground">Yükleniyor...</p>
              )}

              {distribution && distribution.status.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {distribution && distribution.status.some((row) => row.count > 0) && (
                <ChartContainer config={STATUS_CHART_CONFIG} className="h-64 w-full">
                  <BarChart
                    data={distribution.status.map((row) => ({
                      label: STATUS_LABELS[row.status] ?? row.status,
                      count: row.count,
                    }))}
                    margin={{ top: 24 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                      <LabelList dataKey="count" position="top" className="fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Öncelik Dağılımı</CardTitle>
            </CardHeader>
            <CardContent>
              {distributionQuery.isPending && (
                <p className="text-muted-foreground">Yükleniyor...</p>
              )}

              {distribution && distribution.priority.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {distribution && distribution.priority.some((row) => row.count > 0) && (
                <ChartContainer config={PRIORITY_CHART_CONFIG} className="h-64 w-full">
                  <BarChart
                    data={distribution.priority.map((row) => ({
                      label: PRIORITY_LABELS[row.priority] ?? row.priority,
                      count: row.count,
                    }))}
                    margin={{ top: 24 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                      <LabelList dataKey="count" position="top" className="fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Talep Türü Dağılımı</CardTitle>
            </CardHeader>
            <CardContent>
              {distributionQuery.isPending && (
                <p className="text-muted-foreground">Yükleniyor...</p>
              )}

              {distribution && distribution.requestType.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {distribution && distribution.requestType.some((row) => row.count > 0) && (
                <ChartContainer config={REQUEST_TYPE_CHART_CONFIG} className="h-64 w-full">
                  <BarChart
                    data={distribution.requestType}
                    layout="vertical"
                    margin={{ right: 32 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="requestType"
                      tickLine={false}
                      axisLine={false}
                      width={140}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                      <LabelList dataKey="count" position="right" className="fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Departman Dağılımı</CardTitle>
            </CardHeader>
            <CardContent>
              {distributionQuery.isPending && (
                <p className="text-muted-foreground">Yükleniyor...</p>
              )}

              {distribution && distribution.department.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {distribution && distribution.department.some((row) => row.count > 0) && (
                <ChartContainer config={DEPARTMENT_CHART_CONFIG} className="h-64 w-full">
                  <BarChart
                    data={distribution.department}
                    layout="vertical"
                    margin={{ right: 32 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="department"
                      tickLine={false}
                      axisLine={false}
                      width={140}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                      <LabelList dataKey="count" position="right" className="fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zaman İçinde Hacim</CardTitle>
              <CardAction>
                <div className="flex gap-1">
                  {[7, 30, 90].map((range) => (
                    <Button
                      key={range}
                      type="button"
                      size="sm"
                      variant={days === range ? 'default' : 'outline'}
                      aria-pressed={days === range}
                      onClick={() => setDays(range)}
                    >
                      {range} gün
                    </Button>
                  ))}
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              {distributionQuery.isPending && (
                <p className="text-muted-foreground">Yükleniyor...</p>
              )}

              {distribution && distribution.volumeOverTime.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Bu aralıkta veri yok</p>
                </div>
              )}

              {distribution && distribution.volumeOverTime.some((row) => row.count > 0) && (
                <ChartContainer config={VOLUME_CHART_CONFIG} className="h-64 w-full">
                  <AreaChart data={distribution.volumeOverTime} margin={{ left: 4, right: 12 }}>
                    <defs>
                      <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.7} />
                        <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={24}
                      tickFormatter={(value: string) => `${value.slice(8, 10)}.${value.slice(5, 7)}`}
                    />
                    <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          indicator="line"
                          labelFormatter={(value) => String(value).split('-').reverse().join('.')}
                        />
                      }
                    />
                    <Area
                      dataKey="count"
                      type="natural"
                      stroke="var(--color-count)"
                      strokeWidth={2}
                      fill="url(#volumeFill)"
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {bottlenecksQuery.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Darboğazlar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {bottlenecksQuery.error instanceof Error
                  ? bottlenecksQuery.error.message
                  : 'Darboğaz verileri yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => bottlenecksQuery.refetch()}>
                Tekrar Dene
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!bottlenecksQuery.isError && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>SLA İhlalleri (Departman)</CardTitle>
            </CardHeader>
            <CardContent>
              {bottlenecksQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

              {bottlenecks && bottlenecks.slaBreachByDepartment.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {bottlenecks && bottlenecks.slaBreachByDepartment.some((row) => row.count > 0) && (
                <ChartContainer config={SLA_BREACH_DEPT_CONFIG} className="h-64 w-full">
                  <BarChart
                    data={bottlenecks.slaBreachByDepartment.map((row) => ({
                      label: row.department,
                      count: row.count,
                    }))}
                    margin={{ top: 24 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                      <LabelList dataKey="count" position="top" className="fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SLA İhlalleri (Talep Türü)</CardTitle>
            </CardHeader>
            <CardContent>
              {bottlenecksQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

              {bottlenecks && bottlenecks.slaBreachByRequestType.every((row) => row.count === 0) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {bottlenecks && bottlenecks.slaBreachByRequestType.some((row) => row.count > 0) && (
                <ChartContainer config={SLA_BREACH_TYPE_CONFIG} className="h-64 w-full">
                  <BarChart
                    data={bottlenecks.slaBreachByRequestType.map((row) => ({
                      label: row.requestType,
                      count: row.count,
                    }))}
                    margin={{ top: 24 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4}>
                      <LabelList dataKey="count" position="top" className="fill-foreground" />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Aşama Süreleri</CardTitle>
            </CardHeader>
            <CardContent>
              {bottlenecksQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

              {bottlenecks && bottlenecks.stageDurations.every((row) => row.avg_hours === null) && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <PackageOpen className="size-10" />
                  <p>Henüz veri yok</p>
                </div>
              )}

              {bottlenecks && bottlenecks.stageDurations.some((row) => row.avg_hours !== null) && (
                <>
                  <ChartContainer config={STAGE_DURATION_CONFIG} className="h-64 w-full">
                    <BarChart
                      data={bottlenecks.stageDurations
                        .filter((row) => row.avg_hours !== null)
                        .map((row) => ({
                          label: STAGE_LABELS[row.stage] ?? row.stage,
                          avg_hours: row.avg_hours,
                        }))}
                      layout="vertical"
                      margin={{ right: 32 }}
                    >
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" hide allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        width={140}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="avg_hours" fill="var(--color-avg_hours)" radius={4}>
                        <LabelList dataKey="avg_hours" position="right" className="fill-foreground" />
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  {bottlenecks.stageDurations
                    .filter((row) => row.avg_hours === null)
                    .map((row) => (
                      <p key={row.stage} className="text-sm text-muted-foreground">
                        {STAGE_LABELS[row.stage] ?? row.stage}: Veri yok
                      </p>
                    ))}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Yetkili İş Yükü</CardTitle>
            </CardHeader>
            <CardContent>
              {bottlenecksQuery.isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

              {bottlenecks &&
                (bottlenecks.authorityWorkload.length === 0 ||
                  bottlenecks.authorityWorkload.every((row) => row.active_count === 0)) && (
                  <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                    <PackageOpen className="size-10" />
                    <p>Henüz veri yok</p>
                  </div>
                )}

              {bottlenecks &&
                bottlenecks.authorityWorkload.length > 0 &&
                bottlenecks.authorityWorkload.some((row) => row.active_count > 0) && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Yetkili</TableHead>
                        <TableHead>Departman</TableHead>
                        <TableHead>Aktif Talep</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bottlenecks.authorityWorkload.map((row) => (
                        <TableRow key={row.authority_name + row.department_name}>
                          <TableCell>{row.authority_name}</TableCell>
                          <TableCell>{row.department_name}</TableCell>
                          <TableCell>{row.active_count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
