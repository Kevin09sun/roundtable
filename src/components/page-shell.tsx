/**
 * Single source of truth for authenticated-page content width. Every page
 * that isn't a narrow standalone auth card (login, signup, onboarding, ...)
 * wraps its content in this instead of hand-rolling its own centered
 * max-w-* wrapper -- that drift (every page picking a different width) is
 * exactly what let the header and page content end up misaligned. The
 * max-w-7xl here MUST stay in sync with the inner container in
 * src/components/site-header.tsx so the header bar lines up with the page
 * content underneath it.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 justify-center px-6 py-12">
      <div className="flex w-full max-w-7xl flex-col gap-6">{children}</div>
    </div>
  )
}
