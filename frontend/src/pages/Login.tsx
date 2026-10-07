import { zodResolver } from '@hookform/resolvers/zod'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { Eye, EyeOff, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { ApiError, AUTH_GOOGLE_PATH, AUTH_LOGIN_PATH, apiPost } from '@/lib/api'
import { type AuthUser } from '@/lib/authStorage'
import { loginSchema, type LoginFormValues } from '@/lib/validation'

interface LoginResponse {
  token: string
  user: AuthUser
}

export default function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
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

  async function onSubmit(values: LoginFormValues) {
    setLoading(true)
    setError(null)
    try {
      const result = await apiPost<LoginResponse>(AUTH_LOGIN_PATH, {
        email: values.email,
        password: values.password,
        rememberMe,
      })
      auth.login(result.token, result.user, rememberMe)
      navigate('/')
    } catch (err) {
      handleFailure(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
    setLoading(true)
    setError(null)
    try {
      const result = await apiPost<LoginResponse>(AUTH_GOOGLE_PATH, {
        id_token: credentialResponse.credential,
        rememberMe,
      })
      auth.login(result.token, result.user, rememberMe)
      navigate('/')
    } catch (err) {
      handleFailure(err)
    } finally {
      setLoading(false)
    }
  }

  function handleGoogleError() {
    setError('Google ile giriş başarısız oldu, lütfen tekrar deneyin.')
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
          <CardTitle className="text-2xl">Giriş Yap</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
          >
            <FieldGroup>
              <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor="login-email">Email</FieldLabel>
                    <Input
                      {...field}
                      id="login-email"
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
                    <FieldLabel htmlFor="login-password">Şifre</FieldLabel>
                    <div className="relative">
                      <Input
                        {...field}
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
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

              <Field orientation="horizontal">
                <Checkbox
                  id="login-remember-me"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                  disabled={loading}
                />
                <FieldLabel htmlFor="login-remember-me">Beni hatırla</FieldLabel>
              </Field>
            </FieldGroup>

            {error && (
              <p role="alert" className="text-sm font-normal text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading} loading={loading} className="w-full">
              Giriş Yap
            </Button>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">veya</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex w-full justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                text="signin_with"
              />
            </div>
          </form>

          <p className="mt-5 text-sm text-muted-foreground">
            Hesabın yok mu?{' '}
            <Link to="/register" className="underline underline-offset-4">
              Kayıt ol
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
