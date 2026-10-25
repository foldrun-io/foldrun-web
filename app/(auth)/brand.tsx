// The mark, on the way in. Same folder as the sidebar draws — a person who
// signs in should see the thing they are signing in to, not a bare heading.
export function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-fg" aria-hidden>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 11h18" />
        <circle cx="20.6" cy="19.4" r="3" fill="var(--color-paper)" stroke="none" />
        <circle cx="20.6" cy="19.4" r="1.9" fill="#10b981" stroke="none" />
      </svg>
      <span className="font-cal text-base tracking-tight text-fg">foldrun</span>
    </div>
  );
}
