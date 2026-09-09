import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { PackageOpen } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/context/AuthContext'
import { useDepartments } from '@/lib/departments'
import { ROLE_LABELS, useCreateDepartmentAuthority, useDeactivateUser, useUsers } from '@/lib/users'
import { createDepartmentAuthoritySchema, type CreateDepartmentAuthorityFormValues } from '@/lib/validation'

const SELECT_CLASSES =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40'

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const { data: departments, isPending: departmentsPending, isError: departmentsError, error: departmentsErrorObj, refetch: refetchDepartments } = useDepartments()
  const createMutation = useCreateDepartmentAuthority()
  const deactivateMutation = useDeactivateUser()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: users, isPending: usersPending, isError: usersIsError, error: usersError, refetch: refetchUsers } = useUsers()

  const form = useForm<CreateDepartmentAuthorityFormValues>({
    resolver: zodResolver(createDepartmentAuthoritySchema),
    defaultValues: { name: '', surname: '', email: '', password: '', department_id: '' },
  })

  function onSubmit(values: CreateDepartmentAuthorityFormValues) {
    setSubmitError(null)
    createMutation.mutate(values, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['admin-users'] })
        form.reset()
      },
      onError: (err) => {
        setSubmitError(err instanceof Error ? err.message : 'Kullanıcı oluşturulamadı, lütfen tekrar deneyin')
      },
    })
  }

  function handleDeactivate(id: string) {
    deactivateMutation.mutate(id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Kullanıcılar</h1>

      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Yeni Departman Yetkilisi</CardTitle>
        </CardHeader>
        <CardContent>
          {departmentsPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {departmentsError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {departmentsErrorObj instanceof Error ? departmentsErrorObj.message : 'Departmanlar yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetchDepartments()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!departmentsPending && !departmentsError && departments && (
            <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="admin-user-name">Ad</FieldLabel>
                      <Input
                        {...field}
                        id="admin-user-name"
                        disabled={createMutation.isPending}
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
                      <FieldLabel htmlFor="admin-user-surname">Soyad</FieldLabel>
                      <Input
                        {...field}
                        id="admin-user-surname"
                        disabled={createMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="email"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="admin-user-email">Email</FieldLabel>
                      <Input
                        {...field}
                        id="admin-user-email"
                        disabled={createMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="password"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="admin-user-password">Şifre</FieldLabel>
                      <Input
                        {...field}
                        type="password"
                        id="admin-user-password"
                        disabled={createMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="department_id"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="admin-user-department">Departman</FieldLabel>
                      <select
                        {...field}
                        id="admin-user-department"
                        disabled={createMutation.isPending}
                        aria-invalid={!!fieldState.error}
                        className={SELECT_CLASSES}
                      >
                        <option value="">Seçiniz</option>
                        {departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))}
                      </select>
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

              <Button type="submit" disabled={createMutation.isPending}>
                Oluştur
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Tüm Kullanıcılar</CardTitle>
        </CardHeader>
        <CardContent>
          {usersPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {usersIsError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {usersError instanceof Error ? usersError.message : 'Kullanıcılar yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetchUsers()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!usersPending && !usersIsError && users && users.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Henüz kullanıcı yok</p>
            </div>
          )}

          {!usersPending && !usersIsError && users && users.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad Soyad</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Aksiyon</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.name} {row.surname ?? ''}
                    </TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{ROLE_LABELS[row.role] ?? row.role}</TableCell>
                    <TableCell>{row.department_name ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? 'outline' : 'destructive'}>
                        {row.is_active ? 'Aktif' : 'Pasif'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.id !== currentUser?.id && row.is_active ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleDeactivate(row.id)}
                          disabled={deactivateMutation.isPending}
                        >
                          Pasife Al
                        </Button>
                      ) : null}
                    </TableCell>
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
