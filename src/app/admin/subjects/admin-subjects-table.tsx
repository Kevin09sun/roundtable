"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { createSubject, renameSubject, setSubjectActive } from "@/lib/actions/subjects"
import { createSubjectSchema } from "@/lib/validations/intake"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Subject = {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

export function AdminSubjectsTable({ subjects }: { subjects: Subject[] }) {
  const router = useRouter()
  const [newName, setNewName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleCreate() {
    setError(null)
    const parsed = createSubjectSchema.safeParse({ name: newName })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input.")
      return
    }

    const result = await createSubject(parsed.data)
    if ("error" in result) {
      setError(result.error)
      return
    }

    setNewName("")
    router.refresh()
  }

  function startEdit(subject: Subject) {
    setEditingId(subject.id)
    setEditingName(subject.name)
    setError(null)
  }

  async function handleRename(id: string) {
    setError(null)
    const result = await renameSubject({ id, name: editingName })
    if ("error" in result) {
      setError(result.error)
      return
    }

    setEditingId(null)
    router.refresh()
  }

  async function handleToggleActive(subject: Subject) {
    setError(null)
    setPendingId(subject.id)
    const result = await setSubjectActive({
      id: subject.id,
      isActive: !subject.is_active,
    })
    setPendingId(null)

    if ("error" in result) {
      setError(result.error)
      return
    }

    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subjects</CardTitle>
        <CardDescription>
          Add, rename, and activate/deactivate tutoring subjects.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex gap-2">
          <Input
            placeholder="New subject name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button type="button" onClick={handleCreate}>
            Add
          </Button>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        {subjects.length === 0 ? (
          <p className="text-muted-foreground text-sm">No subjects yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => (
                <TableRow key={subject.id}>
                  <TableCell>
                    {editingId === subject.id ? (
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      subject.name
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={subject.is_active ? "default" : "secondary"}>
                      {subject.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {editingId === subject.id ? (
                        <>
                          <Button size="sm" onClick={() => handleRename(subject.id)}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => startEdit(subject)}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pendingId === subject.id}
                            onClick={() => handleToggleActive(subject)}
                          >
                            {subject.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
