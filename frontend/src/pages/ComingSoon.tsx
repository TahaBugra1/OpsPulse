import { Card, CardContent } from '@/components/ui/card'

export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card className="w-full max-w-3xl">
        <CardContent>
          <p className="text-muted-foreground">Bu özellik yakında eklenecek</p>
        </CardContent>
      </Card>
    </div>
  )
}
