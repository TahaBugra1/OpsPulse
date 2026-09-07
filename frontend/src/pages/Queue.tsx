import { PackageOpen } from 'lucide-react'
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useSocket } from '@/context/SocketContext'
import { ApiError } from '@/lib/api'
import { PRIORITY_LABELS, type RequestListItem, useClaimRequest, useOpenQueue } from '@/lib/requests'

export default function Queue() {
  const { user } = useAuth()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useOpenQueue()
  const canClaim = user?.role === 'DEPARTMENT_AUTHORITY'

  useEffect(() => {
    if (!socket) return

    function handleRemoved(payload: { id: string }) {
      queryClient.setQueryData(['requests', 'queue'], (old: RequestListItem[] | undefined) =>
        old?.filter((request) => request.id !== payload.id),
      )
    }

    socket.on('request:removedFromQueue', handleRemoved)

    return () => {
      socket.off('request:removedFromQueue', handleRemoved)
    }
  }, [socket, queryClient])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Kuyruk</h1>
      <Card className="w-full">
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Kuyruk yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && data && data.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Kuyrukta talep yok</p>
            </div>
          )}

          {!isPending && !isError && data && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Başlık</TableHead>
                  <TableHead>Öncelik</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead>Oluşturulma Tarihi</TableHead>
                  {canClaim && <TableHead>Aksiyon</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((request) => (
                  <QueueRow key={request.id} request={request} canClaim={canClaim} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function QueueRow({ request, canClaim }: { request: RequestListItem; canClaim: boolean }) {
  const queryClient = useQueryClient()
  const claimMutation = useClaimRequest(request.id)

  function handleClaim() {
    claimMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['requests', 'queue'] })
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          queryClient.invalidateQueries({ queryKey: ['requests', 'queue'] })
        }
      },
    })
  }

  return (
    <TableRow>
      <TableCell>#{request.request_number}</TableCell>
      <TableCell>{request.title}</TableCell>
      <TableCell>{PRIORITY_LABELS[request.priority] ?? request.priority}</TableCell>
      <TableCell>{request.department_name}</TableCell>
      <TableCell>{new Date(request.created_at).toLocaleString('tr-TR')}</TableCell>
      {canClaim && (
        <TableCell>
          <Button type="button" size="sm" onClick={handleClaim} disabled={claimMutation.isPending}>
            Üstlen
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}
