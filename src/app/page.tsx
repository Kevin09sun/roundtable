import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-linear-to-b from-green-50 via-white to-green-100 px-6 text-center">
      <span className="relative inline-block size-2.5">
        <span
          className="absolute inset-0 -m-2 rounded-full bg-gold-400/40 blur-lg"
          aria-hidden="true"
        />
        <span
          className="inline-block size-2.5 rounded-full bg-gold-400"
          aria-hidden="true"
        />
      </span>
      <h1 className="text-gradient-brand text-3xl font-semibold tracking-tight">
        Roundtable Peer Tutoring Program
      </h1>
      <p className="text-muted-foreground">
        Peer tutoring at Crescent School
      </p>
      <div className="mt-2 flex gap-3 text-sm">
        <Button asChild>
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/signup">Sign up</Link>
        </Button>
      </div>
    </div>
  );
}
