import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Geçerli bir email adresi girin'),
  password: z.string().min(1, 'Şifre zorunlu'),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Ad zorunlu').max(150, 'Ad en fazla 150 karakter olabilir'),
  surname: z.string().trim().max(150, 'Soyad en fazla 150 karakter olabilir'),
})

export type ProfileFormValues = z.infer<typeof profileSchema>
