import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/context/AuthContext'
import { ApiError, AUTH_REGISTER_PATH, apiPost } from '@/lib/api'
import { type AuthUser } from '@/lib/authStorage'
import { usePublicDepartments } from '@/lib/departments'
import { registerSchema, type RegisterFormValues } from '@/lib/validation'

interface RegisterResponse {
  token: string
  user: AuthUser
}

export default function Register() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const { data: departments, isPending, isError, error: departmentsError, refetch } = usePublicDepartments()

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', surname: '', email: '', password: '', department_id: '' },
  })

  function handleFailure(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 429) {
        setError('Çok fazla deneme yaptınız, lütfen bir süre sonra tekrar deneyin.')
      } else {
        setError(err.message)
      }
    } else {
      setError('Sunucuya bağlanılamadı, lütfen tekrar deneyin.')
    }
  }

  async function onSubmit(values: RegisterFormValues) {
    setLoading(true)
    setError(null)
    try {
      const result = await apiPost<RegisterResponse>(AUTH_REGISTER_PATH, values)
      auth.login(result.token, result.user, false)
      navigate('/')
    } catch (err) {
      handleFailure(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background p-6">
      <button
        type="button"
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        aria-label={resolvedTheme === 'dark' ? 'Aydınlık moda geç' : 'Karanlık moda geç'}
        className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
      >
        {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Kayıt Ol</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {departmentsError instanceof Error ? departmentsError.message : 'Departmanlar yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && departments && departments.length === 0 && (
            <p role="alert" className="text-sm font-normal text-destructive">
              Aktif departman bulunmadığı için şu anda kayıt olunamıyor. Lütfen yöneticinizle iletişime geçin.
            </p>
          )}

          {!isPending && !isError && departments && departments.length > 0 && (
            <form className="flex flex-col gap-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="register-name">Ad</FieldLabel>
                      <Input
                        {...field}
                        id="register-name"
                        autoComplete="given-name"
                        disabled={loading}
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
                      <FieldLabel htmlFor="register-surname">Soyad</FieldLabel>
                      <Input
                        {...field}
                        id="register-surname"
                        autoComplete="family-name"
                        disabled={loading}
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
                      <FieldLabel htmlFor="register-email">Email</FieldLabel>
                      <Input
                        {...field}
                        id="register-email"
                        type="email"
                        autoComplete="email"
                        disabled={loading}
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
                      <FieldLabel htmlFor="register-password">Şifre</FieldLabel>
                      <div className="relative">
                        <Input
                          {...field}
                          id="register-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          disabled={loading}
                          aria-invalid={!!fieldState.error}
                          className="pr-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground outline-none hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                    </Field>
                  )}
                />

                <Controller
                  control={form.control}
                  name="department_id"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor="register-department">Departman</FieldLabel>
                      <Select
                        {...field}
                        id="register-department"
                        disabled={loading}
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

              {error && (
                <p role="alert" className="text-sm font-normal text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={loading} loading={loading} className="w-full">
                Kayıt Ol
              </Button>
            </form>
          )}

          <p className="mt-5 text-sm text-muted-foreground">
            Zaten hesabın var mı?{' '}
            <Link to="/login" className="underline underline-offset-4">
              Giriş yap
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
