import { zodResolver } from '@hookform/resolvers/zod'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/AuthContext'
import { ApiError, apiPost } from '@/lib/api'
import { type AuthUser } from '@/lib/authStorage'
import { loginSchema, type LoginFormValues } from '@/lib/validation'

interface LoginResponse {
  token: string
  user: AuthUser
}

export default function Login() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      const result = await apiPost<LoginResponse>('/api/auth/login', {
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
      const result = await apiPost<LoginResponse>('/api/auth/google', {
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
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
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
                    <Input
                      {...field}
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      disabled={loading}
                      aria-invalid={!!fieldState.error}
                    />
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

            <Button type="submit" disabled={loading} className="w-full">
              Giriş Yap
            </Button>

            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                text="signin_with"
              />
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
