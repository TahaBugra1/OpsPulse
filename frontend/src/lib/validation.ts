import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Geçerli bir email adresi girin'),
  password: z.string().min(1, 'Şifre zorunlu'),
})

export type LoginFormValues = z.infer<typeof loginSchema>
