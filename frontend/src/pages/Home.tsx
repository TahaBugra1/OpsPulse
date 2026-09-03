import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Home() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl">OpsPulse</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3">
          <Badge variant="secondary">Yapım aşamasında</Badge>
          <p className="text-muted-foreground">
            Şirket operasyon merkezi yakında burada olacak.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
