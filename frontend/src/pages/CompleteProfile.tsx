import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/context/AuthContext'
import { usePublicDepartments } from '@/lib/departments'
import { useCompleteDepartment } from '@/lib/users'
import { completeProfileSchema, type CompleteProfileFormValues } from '@/lib/validation'

export default function CompleteProfile() {
  const { updateUser } = useAuth()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: departments, isPending, isError, error, refetch } = usePublicDepartments()
  const mutation = useCompleteDepartment()

  const form = useForm<CompleteProfileFormValues>({
    resolver: zodResolver(completeProfileSchema),
    defaultValues: { department_id: '' },
  })

  function onSubmit(values: CompleteProfileFormValues) {
    setSubmitError(null)
    mutation.mutate(values, {
      onSuccess: (updated) => {
        updateUser({
          id: updated.id,
          name: updated.name,
          surname: updated.surname,
          email: updated.email,
          role: updated.role,
          department_id: updated.department_id,
        })
        navigate('/')
      },
      onError: (err) => {
        setSubmitError(err instanceof Error ? err.message : 'Departman kaydedilemedi, lütfen tekrar deneyin')
      },
    })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Departmanınızı Seçin</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-5 text-sm text-muted-foreground">
            Devam edebilmek için çalıştığınız departmanı seçmeniz gerekiyor.
          </p>

          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Departmanlar yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && departments && departments.length === 0 && (
            <p role="alert" className="text-sm font-normal text-destructive">
              Aktif departman bulunmadığı için devam edilemiyor. Lütfen yöneticinizle iletişime geçin.
            </p>
          )}

          {!isPending && !isError && departments && departments.length > 0 && (
            <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="department_id"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="complete-profile-department">Departman</FieldLabel>
                      <Select
                        {...field}
                        id="complete-profile-department"
                        disabled={mutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        <option value="">Seçiniz</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
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

              <Button type="submit" disabled={mutation.isPending} className="w-full">
                Devam Et
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
