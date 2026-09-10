"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { completeOnboarding } from "@/lib/actions/profile"
import { onboardingSchema, type OnboardingInput } from "@/lib/validations/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const GRADES = Array.from({ length: 10 }, (_, i) => i + 3) // 3..12

type Props = {
  defaultFullName: string
  defaultGrade?: number
}

export function OnboardingForm({ defaultFullName, defaultGrade }: Props) {
  const router = useRouter()

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      fullName: defaultFullName,
      // react-hook-form needs a defined value; the zod schema will reject
      // NaN with "Select a grade." if the user never picks one.
      grade: defaultGrade ?? Number.NaN,
    },
  })

  async function onSubmit(values: OnboardingInput) {
    const result = await completeOnboarding(values)

    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Tell us about yourself</CardTitle>
        <CardDescription>
          Just a couple of details before you get started.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="grade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Grade</FormLabel>
                  <FormControl>
                    <Select
                      // Always pass a defined string so the Select stays
                      // controlled for its whole lifetime — "" reads as
                      // "nothing selected" (placeholder shows) without
                      // ever handing Radix an `undefined` value.
                      value={Number.isNaN(field.value) ? "" : String(field.value)}
                      onValueChange={(value) => field.onChange(Number(value))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select your grade" />
                      </SelectTrigger>
                      <SelectContent>
                        {GRADES.map((grade) => (
                          <SelectItem key={grade} value={String(grade)}>
                            Grade {grade}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p className="text-destructive text-sm">
                {form.formState.errors.root.message}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Saving..." : "Continue"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  )
}
