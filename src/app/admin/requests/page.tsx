import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import {
  AdminRequestsQueue,
  type PendingRequestRow,
  type SuggestedTutor,
} from "./admin-requests-queue"

// Raw shapes as they come back from Supabase. subject_id -> subjects.id and
// student_id -> profiles.id are both to-one FKs, so PostgREST embeds a
// single object at runtime -- the untyped Supabase client (no generated
// Database types in this repo, see src/app/request-help/page.tsx for the
// same cast) infers them as arrays instead. Cast at this one boundary
// rather than mistyping these to match the client's incorrect guess.
type RawRequest = {
  id: string
  subject_id: string
  student_id: string | null
  student_name_raw: string | null
  source: "self" | "teacher"
  referred_by_name: string | null
  created_at: string
  subject: { name: string } | null
  student: { full_name: string } | null
}
type RawTutorSubject = {
  tutor_id: string
  subject_id: string
  max_tutees: number
  availability_note: string | null
  tutor: { full_name: string } | null
}

export default async function AdminRequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Defense in depth: re-check admin status server-side rather than
  // relying on the proxy alone (same pattern as every other /admin/* page).
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) {
    redirect("/dashboard")
  }

  const { data: requestsData } = await supabase
    .from("tutee_requests")
    .select(
      `id, subject_id, student_id, student_name_raw, source, referred_by_name, created_at,
       subject:subjects(name),
       student:profiles(full_name)`
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  const pending = (requestsData ?? []) as unknown as RawRequest[]
  const requestIds = pending.map((r) => r.id)
  const subjectIds = [...new Set(pending.map((r) => r.subject_id))]

  const [{ data: notesData }, { data: tutorSubjectsData }, { data: activePairingsData }] =
    await Promise.all([
      requestIds.length > 0
        ? supabase.from("tutee_request_notes").select("request_id, note").in("request_id", requestIds)
        : Promise.resolve({ data: [] as { request_id: string; note: string }[] }),
      subjectIds.length > 0
        ? supabase
            .from("tutor_subjects")
            .select("tutor_id, subject_id, max_tutees, availability_note, tutor:profiles(full_name)")
            .in("subject_id", subjectIds)
        : Promise.resolve({ data: [] as RawTutorSubject[] }),
      supabase.from("pairings").select("tutor_id, tutee_id, subject_id").eq("status", "active"),
    ])

  const notesByRequest = new Map((notesData ?? []).map((n) => [n.request_id, n.note]))

  // Remaining capacity is (max_tutees - current active pairings) PER
  // (tutor, subject) -- computed here from one query of every active
  // pairing rather than one query per tutor, since this page can have many
  // pending requests each fanning out to many candidate tutors.
  const activeCountByTutorSubject = new Map<string, number>()
  const activePairKeys = new Set<string>()
  for (const p of activePairingsData ?? []) {
    const capacityKey = `${p.tutor_id}|${p.subject_id}`
    activeCountByTutorSubject.set(capacityKey, (activeCountByTutorSubject.get(capacityKey) ?? 0) + 1)
    activePairKeys.add(`${p.tutor_id}|${p.tutee_id}|${p.subject_id}`)
  }

  const tutorsBySubject = new Map<string, SuggestedTutor[]>()
  for (const ts of (tutorSubjectsData ?? []) as unknown as RawTutorSubject[]) {
    const activeCount = activeCountByTutorSubject.get(`${ts.tutor_id}|${ts.subject_id}`) ?? 0
    const list = tutorsBySubject.get(ts.subject_id) ?? []
    list.push({
      tutorId: ts.tutor_id,
      fullName: ts.tutor?.full_name ?? "Unknown tutor",
      remainingCapacity: ts.max_tutees - activeCount,
      maxTutees: ts.max_tutees,
      availabilityNote: ts.availability_note,
    })
    tutorsBySubject.set(ts.subject_id, list)
  }

  const requests: PendingRequestRow[] = pending.map((r) => {
    const candidateTutors = tutorsBySubject.get(r.subject_id) ?? []
    // Suggestions only make sense once the request is linked to a real
    // student -- see the guard comment in src/lib/actions/pairing.ts.
    // Excludes: the requesting student themselves, tutors at zero
    // remaining capacity (they cannot be paired anyway -- see the
    // suggested-tutors design note in admin-requests-queue.tsx), and any
    // tutor already actively paired with this student for this subject.
    const suggestedTutors = r.student_id
      ? candidateTutors
          .filter((t) => t.tutorId !== r.student_id)
          .filter((t) => t.remainingCapacity > 0)
          .filter((t) => !activePairKeys.has(`${t.tutorId}|${r.student_id}|${r.subject_id}`))
          .sort((a, b) => b.remainingCapacity - a.remainingCapacity)
      : []

    return {
      id: r.id,
      subjectId: r.subject_id,
      subjectName: r.subject?.name ?? "Unknown subject",
      source: r.source,
      studentId: r.student_id,
      studentName: r.student?.full_name ?? null,
      studentNameRaw: r.student_name_raw,
      referredByName: r.referred_by_name,
      createdAt: r.created_at,
      note: notesByRequest.get(r.id) ?? null,
      suggestedTutors,
    }
  })

  return (
    <div className="flex flex-1 justify-center px-6 py-12">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/requests" className="font-medium underline-offset-4 hover:underline">
            Requests
          </Link>
          <Link
            href="/admin/pairings"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Pairings
          </Link>
          <Link
            href="/admin/subjects"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Subjects
          </Link>
        </nav>
        <AdminRequestsQueue requests={requests} />
      </div>
    </div>
  )
}
