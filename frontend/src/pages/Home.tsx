import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'

export default function Home() {
  const { user } = useAuth()

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl">OpsPulse</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <p className="text-muted-foreground">
            {user ? `Hoş geldin, ${user.name} (${user.role})` : 'Hoş geldin'}
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
