export default function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-2 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Bu özellik yakında eklenecek</p>
    </div>
  )
}