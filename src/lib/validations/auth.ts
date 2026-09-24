import { z } from "zod"

// Shared between the client-side forms (react-hook-form + zodResolver) and
// the server actions that back them. The server actions re-validate with
// these same schemas — never trust client-side validation alone.

export const CRESCENT_EMAIL_DOMAIN = "crescentschool.org"

// Pure, framework-free helper so it's trivial to unit test on its own and
// reusable anywhere else email domain needs checking. Case-insensitive,
// tolerant of surrounding whitespace, but strict about the suffix: it must
// end in exactly "@crescentschool.org", not a lookalike domain (e.g.
// "@evilcrescentschool.org") or a subdomain-suffix trick
// (e.g. "@crescentschool.org.evil.com").
export function isCrescentEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${CRESCENT_EMAIL_DOMAIN}`)
}

export const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(200, "Full name is too long."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .refine(isCrescentEmail, "Use your @crescentschool.org school email."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters."),
})
export type SignupInput = z.infer<typeof signupSchema>

export const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
})
export type LoginInput = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address."),
})
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>

export const onboardingSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(200, "Full name is too long."),
  grade: z
    .number({ error: "Select a grade." })
    .int("Select a grade.")
    .min(3, "Grade must be between 3 and 12.")
    .max(12, "Grade must be between 3 and 12."),
})
export type OnboardingInput = z.infer<typeof onboardingSchema>
