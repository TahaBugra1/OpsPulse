import { PackageOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/context/PageTitleContext'
import { useMyTeam } from '@/lib/users'

export default function Team() {
  const { data: team, isPending, isError, error, refetch } = useMyTeam()
  usePageTitle('Ekibim')

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full">
        <CardContent>
          {isPending && <p className="text-muted-foreground">Yükleniyor...</p>}

          {isError && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm font-normal text-destructive">
                {error instanceof Error ? error.message : 'Ekip listesi yüklenemedi, lütfen tekrar deneyin'}
              </p>
              <Button type="button" onClick={() => refetch()}>
                Tekrar Dene
              </Button>
            </div>
          )}

          {!isPending && !isError && team && team.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <PackageOpen className="size-10" />
              <p>Departmanınızda henüz çalışan yok</p>
            </div>
          )}

          {!isPending && !isError && team && team.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad Soyad</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Durum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.name} {row.surname ?? ''}
                    </TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? 'outline' : 'destructive'}>
                        {row.is_active ? 'Aktif' : 'Pasif'}
                      </Badge>
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
