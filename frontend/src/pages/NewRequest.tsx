import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { usePageTitle } from '@/context/PageTitleContext'
import { PRIORITY_LABELS, useCreateRequest, useRequestTypes } from '@/lib/requests'
import { requestSchema, type RequestFormValues } from '@/lib/validation'

export default function NewRequest() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: requestTypes, isPending, isError, error, refetch } = useRequestTypes()
  const mutation = useCreateRequest()
  const [submitError, setSubmitError] = useState<string | null>(null)
  usePageTitle('Yeni Talep')

  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { title: '', description: '', request_type_id: '', priority: 'MEDIUM' },
  })

  function onSubmit(values: RequestFormValues) {
    setSubmitError(null)
    mutation.mutate(values, {
      onSuccess: (created) => {
        queryClient.invalidateQueries({ queryKey: ['requests'] })
        navigate(`/requests/${created.id}`)
      },
      onError: (err) => {
        setSubmitError(err instanceof Error ? err.message : 'Talep oluşturulamadı, lütfen tekrar deneyin')
      },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full max-w-3xl">
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Talep türleri yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && requestTypes && (
            <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="title"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="new-request-title">Başlık</FieldLabel>
                      <Input
                        {...field}
                        id="new-request-title"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="description"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="new-request-description">Açıklama</FieldLabel>
                      <Input
                        {...field}
                        id="new-request-description"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="request_type_id"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="new-request-type">Talep Tipi</FieldLabel>
                      <Select
                        {...field}
                        id="new-request-type"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        <option value="">Seçiniz</option>
                        {requestTypes.map((requestType) => (
                          <option key={requestType.id} value={requestType.id}>
                            {requestType.name}
                          </option>
                        ))}
                      </Select>
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="new-request-priority">Öncelik</FieldLabel>
                      <Select
                        {...field}
                        id="new-request-priority"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />
              </FieldGroup>

              {submitError && (
                <p role="alert" className="text-sm font-normal text-destructive">
                  {submitError}
                </p>
              )}

              <Button type="submit" disabled={mutation.isPending}>
                Oluştur
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
