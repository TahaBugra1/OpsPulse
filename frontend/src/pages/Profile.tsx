import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { ROLE_LABELS, useProfile, useUpdateProfile } from '@/lib/users'
import { profileSchema, type ProfileFormValues } from '@/lib/validation'

export default function Profile() {
  const { updateUser } = useAuth()
  const { data, isPending, isError, error, refetch } = useProfile()
  const queryClient = useQueryClient()
  const mutation = useUpdateProfile()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: '', surname: '' },
  })

  useEffect(() => {
    if (data && !form.formState.isDirty) {
      form.reset({ name: data.name, surname: data.surname ?? '' })
    }
  }, [data, form])

  function onSubmit(values: ProfileFormValues) {
    setSubmitError(null)
    mutation.mutate(
      { name: values.name, surname: values.surname ? values.surname : null },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(['profile'], updated)
          updateUser({
            id: updated.id,
            name: updated.name,
            surname: updated.surname,
            email: updated.email,
            role: updated.role,
            department_id: updated.department_id,
          })
          toast.success('Profiliniz güncellendi')
        },
        onError: (err) => {
          setSubmitError(err instanceof Error ? err.message : 'Profil güncellenemedi, lütfen tekrar deneyin')
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Profil</h1>
      <Card className="w-full max-w-3xl">
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Profil yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && data && (
            <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <FieldGroup>
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <p className="text-sm text-muted-foreground">{data.email}</p>
                </Field>

                <Field>
                  <FieldLabel>Rol</FieldLabel>
                  <p className="text-sm text-muted-foreground">{ROLE_LABELS[data.role] ?? data.role}</p>
                </Field>

                <Field>
                  <FieldLabel>Departman</FieldLabel>
                  <p className="text-sm text-muted-foreground">{data.department_name ?? '—'}</p>
                </Field>

                <Controller
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="profile-name">Ad</FieldLabel>
                      <Input
                        {...field}
                        id="profile-name"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="surname"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="profile-surname">Soyad</FieldLabel>
                      <Input
                        {...field}
                        id="profile-surname"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
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
                Kaydet
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
