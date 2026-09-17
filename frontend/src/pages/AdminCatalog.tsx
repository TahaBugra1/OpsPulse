import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { PackageOpen } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { usePageTitle } from '@/context/PageTitleContext'
import {
  type Department,
  useActivateDepartment,
  useCreateDepartment,
  useDeactivateDepartment,
  useDepartments,
  useUpdateDepartment,
} from '@/lib/departments'
import {
  type RequestType,
  useActivateRequestType,
  useAllRequestTypes,
  useCreateRequestType,
  useDeactivateRequestType,
  useUpdateRequestType,
} from '@/lib/requests'
import {
  createDepartmentSchema,
  createRequestTypeSchema,
  type CreateDepartmentFormValues,
  type CreateRequestTypeFormValues,
} from '@/lib/validation'

export default function AdminCatalog() {
  usePageTitle('Katalog')
  const queryClient = useQueryClient()

  const {
    data: departments,
    isPending: departmentsPending,
    isError: departmentsIsError,
    error: departmentsError,
    refetch: refetchDepartments,
  } = useDepartments()
  const {
    data: requestTypes,
    isPending: requestTypesPending,
    isError: requestTypesIsError,
    error: requestTypesError,
    refetch: refetchRequestTypes,
  } = useAllRequestTypes()

  const createDepartmentMutation = useCreateDepartment()
  const createRequestTypeMutation = useCreateRequestType()

  const [departmentSubmitError, setDepartmentSubmitError] = useState<string | null>(null)
  const [requestTypeSubmitError, setRequestTypeSubmitError] = useState<string | null>(null)

  const departmentForm = useForm<CreateDepartmentFormValues>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: { name: '' },
  })

  const requestTypeForm = useForm<CreateRequestTypeFormValues>({
    resolver: zodResolver(createRequestTypeSchema),
    defaultValues: { name: '', department_id: '' },
  })

  function onCreateDepartment(values: CreateDepartmentFormValues) {
    setDepartmentSubmitError(null)
    createDepartmentMutation.mutate(values, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['departments'] })
        departmentForm.reset()
      },
      onError: (err) => {
        setDepartmentSubmitError(err instanceof Error ? err.message : 'Departman oluşturulamadı, lütfen tekrar deneyin')
      },
    })
  }

  function onCreateRequestType(values: CreateRequestTypeFormValues) {
    setRequestTypeSubmitError(null)
    createRequestTypeMutation.mutate(values, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['request-types', 'all'] })
        queryClient.invalidateQueries({ queryKey: ['request-types'] })
        requestTypeForm.reset()
      },
      onError: (err) => {
        setRequestTypeSubmitError(err instanceof Error ? err.message : 'Talep türü oluşturulamadı, lütfen tekrar deneyin')
      },
    })
  }

  const activeDepartments = departments?.filter((department) => department.is_active) ?? []

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Yeni Departman</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-5" onSubmit={departmentForm.handleSubmit(onCreateDepartment)} noValidate>
            <FieldGroup>
              <Controller
                control={departmentForm.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="new-department-name">Ad</FieldLabel>
                    <Input
                      {...field}
                      id="new-department-name"
                      disabled={createDepartmentMutation.isPending}
                      aria-invalid={!!fieldState.error}
                    />
                    <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                  </Field>
                )}
              />
            </FieldGroup>

            {departmentSubmitError && (
              <p role="alert" className="text-sm font-normal text-destructive">
                {departmentSubmitError}
              </p>
            )}

            <Button type="submit" disabled={createDepartmentMutation.isPending}>
              Oluştur
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Departmanlar</CardTitle>
        </CardHeader>
        <CardContent>
          {departmentsPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {departmentsIsError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {departmentsError instanceof Error ? departmentsError.message : 'Departmanlar yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetchDepartments()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!departmentsPending && !departmentsIsError && departments && departments.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Henüz departman yok</p>
            </div>
          )}

          {!departmentsPending && !departmentsIsError && departments && departments.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Aksiyon</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((department) => (
                  <DepartmentRow key={department.id} department={department} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Yeni Talep Türü</CardTitle>
        </CardHeader>
        <CardContent>
          {departmentsPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {departmentsIsError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {departmentsError instanceof Error ? departmentsError.message : 'Departmanlar yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetchDepartments()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!departmentsPending && !departmentsIsError && departments && (
            <form className="flex flex-col gap-5" onSubmit={requestTypeForm.handleSubmit(onCreateRequestType)} noValidate>
              <FieldGroup>
                <Controller
                  control={requestTypeForm.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="new-request-type-name">Ad</FieldLabel>
                      <Input
                        {...field}
                        id="new-request-type-name"
                        disabled={createRequestTypeMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={requestTypeForm.control}
                  name="department_id"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="new-request-type-department">Departman</FieldLabel>
                      <Select
                        {...field}
                        id="new-request-type-department"
                        disabled={createRequestTypeMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        <option value="">Seçiniz</option>
                        {activeDepartments.map((department) => (
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

              {requestTypeSubmitError && (
                <p role="alert" className="text-sm font-normal text-destructive">
                  {requestTypeSubmitError}
                </p>
              )}

              <Button type="submit" disabled={createRequestTypeMutation.isPending}>
                Oluştur
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Talep Türleri</CardTitle>
        </CardHeader>
        <CardContent>
          {requestTypesPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {requestTypesIsError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {requestTypesError instanceof Error ? requestTypesError.message : 'Talep türleri yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetchRequestTypes()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!requestTypesPending && !requestTypesIsError && requestTypes && requestTypes.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Henüz talep türü yok</p>
            </div>
          )}

          {!requestTypesPending && !requestTypesIsError && requestTypes && requestTypes.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  <TableHead>Departman</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Aksiyon</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requestTypes.map((requestType) => (
                  <RequestTypeRow
                    key={requestType.id}
                    requestType={requestType}
                    departments={departments ?? []}
                    activeDepartments={activeDepartments}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Per-row mutation hooks (useUpdateDepartment) need an id bound at hook-call
// time, which can't happen inside the parent's .map() — same reason
// RequestDetail.tsx's CommentItem and Queue.tsx's QueueRow exist.
function DepartmentRow({ department }: { department: Department }) {
  const queryClient = useQueryClient()
  const updateMutation = useUpdateDepartment(department.id)
  const deactivateMutation = useDeactivateDepartment()
  const activateMutation = useActivateDepartment()

  const [editOpen, setEditOpen] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const editForm = useForm<CreateDepartmentFormValues>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: { name: department.name },
  })

  function openEdit() {
    setEditError(null)
    editForm.reset({ name: department.name })
    setEditOpen(true)
  }

  function onEditSubmit(values: CreateDepartmentFormValues) {
    setEditError(null)
    updateMutation.mutate(values, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['departments'] })
        setEditOpen(false)
      },
      onError: (err) => {
        setEditError(err instanceof Error ? err.message : 'Departman güncellenemedi, lütfen tekrar deneyin')
      },
    })
  }

  function handleDeactivate() {
    deactivateMutation.mutate(department.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['departments'] })
        queryClient.invalidateQueries({ queryKey: ['request-types', 'all'] })
      },
    })
  }

  function handleActivate() {
    activateMutation.mutate(department.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['departments'] })
      },
    })
  }

  return (
    <TableRow>
      <TableCell>{department.name}</TableCell>
      <TableCell>
        <Badge variant={department.is_active ? 'outline' : 'destructive'}>
          {department.is_active ? 'Aktif' : 'Pasif'}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openEdit}>
            Düzenle
          </Button>
          {department.is_active ? (
            <Button type="button" size="sm" onClick={handleDeactivate} disabled={deactivateMutation.isPending}>
              Pasife Al
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleActivate} disabled={activateMutation.isPending}>
              Aktifleştir
            </Button>
          )}
        </div>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Departmanı Düzenle</DialogTitle>
            </DialogHeader>
            <form className="flex flex-col gap-5" onSubmit={editForm.handleSubmit(onEditSubmit)} noValidate>
              <FieldGroup>
                <Controller
                  control={editForm.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor={`edit-department-name-${department.id}`}>Ad</FieldLabel>
                      <Input
                        {...field}
                        id={`edit-department-name-${department.id}`}
                        disabled={updateMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />
              </FieldGroup>

              {editError && (
                <p role="alert" className="text-sm font-normal text-destructive">
                  {editError}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  İptal
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  Kaydet
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  )
}

function RequestTypeRow({
  requestType,
  departments,
  activeDepartments,
}: {
  requestType: RequestType
  departments: Department[]
  activeDepartments: Department[]
}) {
  const queryClient = useQueryClient()
  const updateMutation = useUpdateRequestType(requestType.id)
  const deactivateMutation = useDeactivateRequestType()
  const activateMutation = useActivateRequestType()

  const [editOpen, setEditOpen] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const editForm = useForm<CreateRequestTypeFormValues>({
    resolver: zodResolver(createRequestTypeSchema),
    defaultValues: { name: requestType.name, department_id: requestType.department_id },
  })

  const departmentName = departments.find((department) => department.id === requestType.department_id)?.name ?? '-'

  // The edit dialog must show the request type's CURRENT department even if it
  // has since been deactivated (otherwise the dropdown falls back to the blank
  // placeholder instead of reflecting the real, still-correct form value) — the
  // create form above intentionally does NOT get this treatment, since a brand
  // new request type should never be assignable to an inactive department.
  const currentDepartment = departments.find((department) => department.id === requestType.department_id)
  const dialogDepartmentOptions =
    currentDepartment && !currentDepartment.is_active
      ? [currentDepartment, ...activeDepartments]
      : activeDepartments

  function openEdit() {
    setEditError(null)
    editForm.reset({ name: requestType.name, department_id: requestType.department_id })
    setEditOpen(true)
  }

  function invalidateRequestTypeQueries() {
    queryClient.invalidateQueries({ queryKey: ['request-types', 'all'] })
    queryClient.invalidateQueries({ queryKey: ['request-types'] })
  }

  function onEditSubmit(values: CreateRequestTypeFormValues) {
    setEditError(null)
    updateMutation.mutate(values, {
      onSuccess: () => {
        invalidateRequestTypeQueries()
        setEditOpen(false)
      },
      onError: (err) => {
        setEditError(err instanceof Error ? err.message : 'Talep türü güncellenemedi, lütfen tekrar deneyin')
      },
    })
  }

  function handleDeactivate() {
    deactivateMutation.mutate(requestType.id, { onSuccess: invalidateRequestTypeQueries })
  }

  function handleActivate() {
    activateMutation.mutate(requestType.id, { onSuccess: invalidateRequestTypeQueries })
  }

  return (
    <TableRow>
      <TableCell>{requestType.name}</TableCell>
      <TableCell>{departmentName}</TableCell>
      <TableCell>
        <Badge variant={requestType.is_active ? 'outline' : 'destructive'}>
          {requestType.is_active ? 'Aktif' : 'Pasif'}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openEdit}>
            Düzenle
          </Button>
          {requestType.is_active ? (
            <Button type="button" size="sm" onClick={handleDeactivate} disabled={deactivateMutation.isPending}>
              Pasife Al
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleActivate} disabled={activateMutation.isPending}>
              Aktifleştir
            </Button>
          )}
        </div>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Talep Türünü Düzenle</DialogTitle>
            </DialogHeader>
            <form className="flex flex-col gap-5" onSubmit={editForm.handleSubmit(onEditSubmit)} noValidate>
              <FieldGroup>
                <Controller
                  control={editForm.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor={`edit-request-type-name-${requestType.id}`}>Ad</FieldLabel>
                      <Input
                        {...field}
                        id={`edit-request-type-name-${requestType.id}`}
                        disabled={updateMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      />
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={editForm.control}
                  name="department_id"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor={`edit-request-type-department-${requestType.id}`}>Departman</FieldLabel>
                      <Select
                        {...field}
                        id={`edit-request-type-department-${requestType.id}`}
                        disabled={updateMutation.isPending}
                        aria-invalid={!!fieldState.error}
                      >
                        <option value="">Seçiniz</option>
                        {dialogDepartmentOptions.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                            {!department.is_active ? ' (Pasif)' : ''}
                          </option>
                        ))}
                      </Select>
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />
              </FieldGroup>

              {editError && (
                <p role="alert" className="text-sm font-normal text-destructive">
                  {editError}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  İptal
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  Kaydet
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  )
}
