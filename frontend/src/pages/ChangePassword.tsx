import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/lib/api'
import { useChangeMyPassword } from '@/lib/users'
import { changePasswordSchema, type ChangePasswordFormValues } from '@/lib/validation'

export default function ChangePassword() {
  const { updateUser } = useAuth()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const mutation = useChangeMyPassword()

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', new_password_confirm: '' },
  })

  function onSubmit(values: ChangePasswordFormValues) {
    setSubmitError(null)
    mutation.mutate(
      { current_password: values.current_password, new_password: values.new_password },
      {
        onSuccess: (updated) => {
          updateUser(updated)
          navigate('/')
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 429) {
            setSubmitError('Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin.')
          } else {
            setSubmitError(err instanceof Error ? err.message : 'Şifre değiştirilemedi, lütfen tekrar deneyin')
          }
        },
      },
    )
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Şifrenizi Değiştirin</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-5 text-sm text-muted-foreground">
            Devam edebilmek için size verilen geçici şifreyi kendi belirleyeceğiniz yeni bir şifreyle değiştirmeniz gerekiyor.
          </p>

          <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Controller
                control={form.control}
                name="current_password"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="change-password-current">Mevcut Şifre</FieldLabel>
                    <Input
                      {...field}
                      type="password"
                      id="change-password-current"
                      autoComplete="current-password"
                      disabled={mutation.isPending}
                      aria-invalid={!!fieldState.error}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="new_password"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="change-password-new">Yeni Şifre</FieldLabel>
                    <Input
                      {...field}
                      type="password"
                      id="change-password-new"
                      autoComplete="new-password"
                      disabled={mutation.isPending}
                      aria-invalid={!!fieldState.error}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="new_password_confirm"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="change-password-confirm">Yeni Şifre (Tekrar)</FieldLabel>
                    <Input
                      {...field}
                      type="password"
                      id="change-password-confirm"
                      autoComplete="new-password"
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

            <Button type="submit" disabled={mutation.isPending} className="w-full">
              Şifreyi Değiştir
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
