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

export const requestSchema = z.object({
  title: z.string().trim().min(3, 'Başlık en az 3 karakter olmalı').max(200, 'Başlık en fazla 200 karakter olabilir'),
  description: z.string().trim().min(1, 'Açıklama zorunlu'),
  request_type_id: z.string().min(1, 'Talep türü seçilmeli'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
})

export type RequestFormValues = z.infer<typeof requestSchema>
