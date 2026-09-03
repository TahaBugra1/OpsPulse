import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
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
import { PRIORITY_LABELS, STATUS_LABELS, useRequests } from '@/lib/requests'

export default function Requests() {
  const navigate = useNavigate()
  const { data, isPending, isError, error, refetch } = useRequests()

  return (
    <main className="flex min-h-svh justify-center bg-background p-6">
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle className="text-2xl">Talepler</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Talepler yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && data && data.length === 0 && (
            <p className="text-muted-foreground">Henüz talep yok</p>
          )}

          {!isPending && !isError && data && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Başlık</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Öncelik</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead>Oluşturulma Tarihi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((request) => (
                  <TableRow
                    key={request.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/requests/${request.id}`)}
                    tabIndex={0}
                    role="link"
                    aria-label={`${request.title} talebini görüntüle`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        if (event.key === ' ') {
                          event.preventDefault()
                        }
                        navigate(`/requests/${request.id}`)
                      }
                    }}
                  >
                    <TableCell>#{request.request_number}</TableCell>
                    <TableCell>{request.title}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline">{STATUS_LABELS[request.status] ?? request.status}</Badge>
                        {request.is_overdue && <Badge variant="destructive">Gecikmiş</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{PRIORITY_LABELS[request.priority] ?? request.priority}</TableCell>
                    <TableCell>{request.department_name}</TableCell>
                    <TableCell>{new Date(request.created_at).toLocaleString('tr-TR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
