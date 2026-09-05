import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { type ChangeEvent, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/lib/api'
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  useAddComment,
  useChangePriority,
  useChangeRequestStatus,
  useClaimRequest,
  useRequest,
  useRequestComments,
} from '@/lib/requests'
import {
  commentSchema,
  rejectNoteSchema,
  type CommentFormValues,
  type RejectNoteFormValues,
} from '@/lib/validation'

const SELECT_CLASSES =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40'

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>()
  const requestId = id ?? ''
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const requestQuery = useRequest(requestId)
  const commentsQuery = useRequestComments(requestId)

  const claimMutation = useClaimRequest(requestId)
  const statusMutation = useChangeRequestStatus(requestId)
  const priorityMutation = useChangePriority(requestId)
  const commentMutation = useAddComment(requestId)

  const [actionError, setActionError] = useState<string | null>(null)
  const [commentError, setCommentError] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)

  const rejectForm = useForm<RejectNoteFormValues>({
    resolver: zodResolver(rejectNoteSchema),
    defaultValues: { note: '' },
  })

  const commentForm = useForm<CommentFormValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { content: '' },
  })

  const isPending = requestQuery.isPending || commentsQuery.isPending
  const isError = requestQuery.isError || commentsQuery.isError
  const error = requestQuery.error ?? commentsQuery.error

  function handleRetry() {
    requestQuery.refetch()
    commentsQuery.refetch()
  }

  // The mutation endpoints return raw DB rows without the JOIN-derived display
  // fields, so the enriched GETs are refetched instead of being written to.
  function invalidateRequest() {
    queryClient.invalidateQueries({ queryKey: ['requests', requestId], exact: true })
    queryClient.invalidateQueries({ queryKey: ['requests'], exact: true })
  }

  function handleActionError(err: unknown) {
    setActionError(err instanceof Error ? err.message : 'İşlem başarısız oldu, lütfen tekrar deneyin')
    if (err instanceof ApiError && err.status === 409) {
      requestQuery.refetch()
    }
  }

  function handleClaim() {
    setActionError(null)
    claimMutation.mutate(undefined, { onSuccess: invalidateRequest, onError: handleActionError })
  }

  function handleStatusChange(status: 'IN_PROGRESS' | 'COMPLETED') {
    setActionError(null)
    statusMutation.mutate({ status }, { onSuccess: invalidateRequest, onError: handleActionError })
  }

  function handlePriorityChange(event: ChangeEvent<HTMLSelectElement>) {
    setActionError(null)
    priorityMutation.mutate(
      { priority: event.target.value as 'LOW' | 'MEDIUM' | 'HIGH' },
      { onSuccess: invalidateRequest, onError: handleActionError },
    )
  }

  function openRejectDialog() {
    setActionError(null)
    setRejectOpen(true)
  }

  function onRejectSubmit(values: RejectNoteFormValues) {
    setActionError(null)
    statusMutation.mutate(
      { status: 'REJECTED', note: values.note },
      {
        onSuccess: () => {
          setRejectOpen(false)
          rejectForm.reset({ note: '' })
          invalidateRequest()
        },
        onError: handleActionError,
      },
    )
  }

  function onCommentSubmit(values: CommentFormValues) {
    setCommentError(null)
    commentMutation.mutate(
      { content: values.content },
      {
        onSuccess: () => {
          commentForm.reset({ content: '' })
          queryClient.invalidateQueries({ queryKey: ['requests', requestId, 'comments'] })
        },
        onError: (err) => {
          setCommentError(err instanceof Error ? err.message : 'Yorum eklenemedi, lütfen tekrar deneyin')
        },
      },
    )
  }

  // Visibility mirrors the backend's real authorization rules (UX only — the
  // backend re-validates every action independently).
  const request = requestQuery.data
  const isDepartmentAuthorityOfRequest =
    !!request && !!user && user.role === 'DEPARTMENT_AUTHORITY' && user.department_id === request.department_id
  const isAssignee = !!request && !!user && user.id === request.assigned_to

  const canClaim = !!request && request.status === 'OPEN' && isDepartmentAuthorityOfRequest
  const canStart = !!request && request.status === 'ASSIGNED' && isAssignee
  const canComplete = !!request && request.status === 'IN_PROGRESS' && isAssignee
  const canReject =
    !!request &&
    ((request.status === 'OPEN' && isDepartmentAuthorityOfRequest) ||
      ((request.status === 'ASSIGNED' || request.status === 'IN_PROGRESS') && isAssignee))
  const canChangePriority =
    !!request && (request.status === 'ASSIGNED' || request.status === 'IN_PROGRESS') && isAssignee
  const canComment = !!user && user.role !== 'ADMIN'
  const hasActions = canClaim || canStart || canComplete || canReject || canChangePriority

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Talep Detayı</h1>
      <Card className="w-full max-w-3xl">
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

          {!isPending && !isError && request && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-medium">
                    #{request.request_number} — {request.title}
                  </h2>
                  {request.is_overdue && <Badge variant="destructive">Gecikmiş</Badge>}
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.description}</p>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-muted-foreground">Durum</dt>
                <dd>
                  <Badge variant="outline">{STATUS_LABELS[request.status] ?? request.status}</Badge>
                </dd>

                <dt className="text-muted-foreground">Öncelik</dt>
                <dd>{PRIORITY_LABELS[request.priority] ?? request.priority}</dd>

                <dt className="text-muted-foreground">Talep Türü</dt>
                <dd>{request.request_type_name}</dd>

                <dt className="text-muted-foreground">Departman</dt>
                <dd>{request.department_name}</dd>

                <dt className="text-muted-foreground">Oluşturan</dt>
                <dd>{request.created_by_name}</dd>

                <dt className="text-muted-foreground">Atanan</dt>
                <dd>{request.assigned_to_name ?? '-'}</dd>

                <dt className="text-muted-foreground">Oluşturulma Tarihi</dt>
                <dd>{new Date(request.created_at).toLocaleString('tr-TR')}</dd>
              </dl>

              {(hasActions || actionError) && (
                <div className="flex flex-col gap-3">
                  {(canClaim || canStart || canComplete || canReject) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canClaim && (
                        <Button type="button" onClick={handleClaim} disabled={claimMutation.isPending}>
                          Üstlen
                        </Button>
                      )}
                      {canStart && (
                        <Button
                          type="button"
                          onClick={() => handleStatusChange('IN_PROGRESS')}
                          disabled={statusMutation.isPending}
                        >
                          İşleme Al
                        </Button>
                      )}
                      {canComplete && (
                        <Button
                          type="button"
                          onClick={() => handleStatusChange('COMPLETED')}
                          disabled={statusMutation.isPending}
                        >
                          Tamamla
                        </Button>
                      )}
                      {canReject && (
                        <Button type="button" variant="destructive" onClick={openRejectDialog}>
                          Reddet
                        </Button>
                      )}
                    </div>
                  )}

                  {canChangePriority && (
                    <Field className="max-w-xs">
                      <FieldLabel htmlFor="request-priority">Öncelik Değiştir</FieldLabel>
                      <select
                        id="request-priority"
                        value={request.priority}
                        onChange={handlePriorityChange}
                        disabled={priorityMutation.isPending}
                        className={SELECT_CLASSES}
                      >
                        {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}

                  {/* While the reject dialog is open the same error is shown inside it
                      instead, so the user is never told the same thing twice. */}
                  {actionError && !rejectOpen && (
                    <p role="alert" className="text-sm font-normal text-destructive">
                      {actionError}
                    </p>
                  )}
                </div>
              )}

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

                {canComment && (
                  <form
                    className="mt-2 flex flex-col gap-3"
                    onSubmit={commentForm.handleSubmit(onCommentSubmit)}
                    noValidate
                  >
                    <Controller
                      control={commentForm.control}
                      name="content"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={!!fieldState.error}>
                          <FieldLabel htmlFor="comment-content">Yorum Ekle</FieldLabel>
                          <Input
                            {...field}
                            id="comment-content"
                            disabled={commentMutation.isPending}
                            aria-invalid={!!fieldState.error}
                          />
                          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                        </Field>
                      )}
                    />

                    {commentError && (
                      <p role="alert" className="text-sm font-normal text-destructive">
                        {commentError}
                      </p>
                    )}

                    <Button type="submit" className="self-start" disabled={commentMutation.isPending}>
                      Gönder
                    </Button>
                  </form>
                )}
              </div>

              <Dialog
                open={rejectOpen}
                onOpenChange={(open) => {
                  setRejectOpen(open)
                  if (!open) setActionError(null)
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Talebi Reddet</DialogTitle>
                    <DialogDescription>Red sebebini belirtmelisiniz.</DialogDescription>
                  </DialogHeader>

                  <form
                    className="flex flex-col gap-4"
                    onSubmit={rejectForm.handleSubmit(onRejectSubmit)}
                    noValidate
                  >
                    <Controller
                      control={rejectForm.control}
                      name="note"
                      render={({ field, fieldState }) => (
                        <Field data-invalid={!!fieldState.error}>
                          <FieldLabel htmlFor="reject-note">Red Sebebi</FieldLabel>
                          <Input
                            {...field}
                            id="reject-note"
                            disabled={statusMutation.isPending}
                            aria-invalid={!!fieldState.error}
                          />
                          <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                        </Field>
                      )}
                    />

                    {actionError && (
                      <p role="alert" className="text-sm font-normal text-destructive">
                        {actionError}
                      </p>
                    )}

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRejectOpen(false)}
                        disabled={statusMutation.isPending}
                      >
                        Vazgeç
                      </Button>
                      <Button type="submit" variant="destructive" disabled={statusMutation.isPending}>
                        Reddet
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
