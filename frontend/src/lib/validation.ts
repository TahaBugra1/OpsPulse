import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Geçerli bir email adresi girin'),
  password: z.string().min(1, 'Şifre zorunlu'),
})

export type LoginFormValues = z.infer<typeof loginSchema>

// Self-registration never carries a role — the backend hardcodes EMPLOYEE.
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Ad zorunlu').max(150, 'Ad en fazla 150 karakter olabilir'),
  surname: z.string().trim().max(150, 'Soyad en fazla 150 karakter olabilir'),
  email: z.string().email('Geçerli bir email adresi girin'),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
  department_id: z.string().min(1, 'Departman seçilmeli'),
})

export type RegisterFormValues = z.infer<typeof registerSchema>

export const completeProfileSchema = z.object({
  department_id: z.string().min(1, 'Departman seçilmeli'),
})

export type CompleteProfileFormValues = z.infer<typeof completeProfileSchema>

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

export const rejectNoteSchema = z.object({
  note: z.string().trim().min(1, 'Red sebebi zorunlu'),
})

export type RejectNoteFormValues = z.infer<typeof rejectNoteSchema>

export const commentSchema = z.object({
  content: z.string().trim().min(1, 'Yorum boş olamaz').max(2000, 'Yorum en fazla 2000 karakter olabilir'),
})

export type CommentFormValues = z.infer<typeof commentSchema>

// The backend generates the password and whitelists the role.
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Ad zorunlu').max(150, 'Ad en fazla 150 karakter olabilir'),
  surname: z.string().trim().max(150, 'Soyad en fazla 150 karakter olabilir'),
  email: z.string().email('Geçerli bir email adresi girin'),
  role: z.string().min(1, 'Rol seçilmeli'),
  department_id: z.string().min(1, 'Departman seçilmeli'),
})

export type CreateUserFormValues = z.infer<typeof createUserSchema>

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Departman adı zorunlu').max(100, 'Departman adı en fazla 100 karakter olabilir'),
})
export type CreateDepartmentFormValues = z.infer<typeof createDepartmentSchema>

export const createRequestTypeSchema = z.object({
  name: z.string().trim().min(1, 'Talep türü adı zorunlu').max(150, 'Talep türü adı en fazla 150 karakter olabilir'),
  department_id: z.string().min(1, 'Departman seçilmeli'),
})
export type CreateRequestTypeFormValues = z.infer<typeof createRequestTypeSchema>

// new_password_confirm is frontend-only; requests send current_password + new_password.
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Mevcut şifre zorunlu'),
    new_password: z.string().min(8, 'Şifre en az 8 karakter olmalı'),
    new_password_confirm: z.string(),
  })
  .refine((v) => v.new_password === v.new_password_confirm, {
    message: 'Şifreler eşleşmiyor',
    path: ['new_password_confirm'],
  })

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>
