import { useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PRIORITY_LABELS, STATUS_LABELS, useRequest, useRequestComments } from '@/lib/requests'

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>()
  const requestQuery = useRequest(id ?? '')
  const commentsQuery = useRequestComments(id ?? '')

  const isPending = requestQuery.isPending || commentsQuery.isPending
  const isError = requestQuery.isError || commentsQuery.isError
  const error = requestQuery.error ?? commentsQuery.error

  function handleRetry() {
    requestQuery.refetch()
    commentsQuery.refetch()
  }

  return (
    <main className="flex min-h-svh justify-center bg-background p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Talep Detayı</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {!isPending && isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Talep yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={handleRetry}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && requestQuery.data && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium">
                    #{requestQuery.data.request_number} — {requestQuery.data.title}
                  </h2>
                  {requestQuery.data.is_overdue && <Badge variant="destructive">Gecikmiş</Badge>}
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {requestQuery.data.description}
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-muted-foreground">Durum</dt>
                <dd>
                  <Badge variant="outline">
                    {STATUS_LABELS[requestQuery.data.status] ?? requestQuery.data.status}
                  </Badge>
                </dd>

                <dt className="text-muted-foreground">Öncelik</dt>
                <dd>{PRIORITY_LABELS[requestQuery.data.priority] ?? requestQuery.data.priority}</dd>

                <dt className="text-muted-foreground">Talep Türü</dt>
                <dd>{requestQuery.data.request_type_name}</dd>

                <dt className="text-muted-foreground">Departman</dt>
                <dd>{requestQuery.data.department_name}</dd>

                <dt className="text-muted-foreground">Oluşturan</dt>
                <dd>{requestQuery.data.created_by_name}</dd>

                <dt className="text-muted-foreground">Atanan</dt>
                <dd>{requestQuery.data.assigned_to_name ?? '-'}</dd>

                <dt className="text-muted-foreground">Oluşturulma Tarihi</dt>
                <dd>{new Date(requestQuery.data.created_at).toLocaleString('tr-TR')}</dd>
              </dl>

              <div className="flex flex-col gap-2">
                <h3 className="text-base font-medium">Yorumlar</h3>
                {commentsQuery.data && commentsQuery.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">Henüz yorum yok</p>
                )}
                {commentsQuery.data && commentsQuery.data.length > 0 && (
                  <ul className="flex flex-col gap-3">
                    {commentsQuery.data.map((comment) => (
                      <li key={comment.id} className="rounded-md border p-3 text-sm">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-medium">{comment.author_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(comment.created_at).toLocaleString('tr-TR')}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{comment.content}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
