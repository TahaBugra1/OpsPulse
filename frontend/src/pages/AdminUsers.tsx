import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { PackageOpen } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
import { useDepartments } from '@/lib/departments'
import { ROLE_LABELS, useCreateUser, useDeactivateUser, useResetUserPassword, useUsers } from '@/lib/users'
import { createUserSchema, type CreateUserFormValues } from '@/lib/validation'

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const { data: departments, isPending: departmentsPending, isError: departmentsError, error: departmentsErrorObj, refetch: refetchDepartments } = useDepartments()
  const createMutation = useCreateUser()
  const deactivateMutation = useDeactivateUser()
  const resetMutation = useResetUserPassword()
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Shown once, then discarded: local state only, never the query cache.
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)
  const { data: users, isPending: usersPending, isError: usersIsError, error: usersError, refetch: refetchUsers } = useUsers()
  usePageTitle('Kullanıcılar')

  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', surname: '', email: '', role: '', department_id: '' },
  })

  function onSubmit(values: CreateUserFormValues) {
    setSubmitError(null)
    createMutation.mutate(values, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ['admin-users'] })
        form.reset()
        setTemporaryPassword(data.temporary_password)
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

  function handleResetPassword(id: string) {
    resetMutation.mutate(id, {
      onSuccess: (data) => {
        setTemporaryPassword(data.temporary_password)
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : 'Şifre sıfırlanamadı, lütfen tekrar deneyin')
      },
    })
  }

  function handleCopyPassword() {
    if (temporaryPassword === null) return
    navigator.clipboard.writeText(temporaryPassword).then(
      () => toast.success('Şifre kopyalandı'),
      () => toast.error('Kopyalanamadı, şifreyi elle kopyalayın'),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Yeni Kullanıcı</CardTitle>
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
                  name="role"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="admin-user-role">Rol</FieldLabel>
                      <Select
                        {...field}
                        id="admin-user-role"
                        disabled={createMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        <option value="">Seçiniz</option>
                        <option value="EMPLOYEE">{ROLE_LABELS.EMPLOYEE}</option>
                        <option value="DEPARTMENT_AUTHORITY">{ROLE_LABELS.DEPARTMENT_AUTHORITY}</option>
                      </Select>
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
                      <Select
                        {...field}
                        id="admin-user-department"
                        disabled={createMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        <option value="">Seçiniz</option>
                        {departments.filter((department) => department.is_active).map((department) => (
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
                      <div className="flex gap-2">
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
                        {row.role !== 'ADMIN' && row.id !== currentUser?.id && row.is_active && row.has_password ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => handleResetPassword(row.id)}
                            disabled={resetMutation.isPending}
                          >
                            Şifre Sıfırla
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={temporaryPassword !== null}
        onOpenChange={(open) => {
          if (!open) setTemporaryPassword(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Geçici Şifre</DialogTitle>
            <DialogDescription>
              Bu şifre bir daha gösterilmeyecek. Kullanıcıya iletin; ilk girişinde şifresini değiştirmesi istenecek.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-base select-all">
              {temporaryPassword}
            </code>
            <Button type="button" variant="outline" onClick={handleCopyPassword}>
              Kopyala
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setTemporaryPassword(null)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
