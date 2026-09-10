import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Roundtable</h1>
      <p className="text-muted-foreground">
        Peer tutoring at Crescent School
      </p>
      <div className="flex gap-4 text-sm">
        <Link
          href="/login"
          className="text-primary underline-offset-4 hover:underline"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="text-primary underline-offset-4 hover:underline"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
