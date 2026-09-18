import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        className="inline-block size-2.5 rounded-full bg-gold-400"
        aria-hidden="true"
      />
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
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
