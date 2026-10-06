export default function AccountLoading() {
  return (
    <main
      className="mx-auto w-full max-w-3xl px-4 py-10"
      aria-busy="true"
      aria-label="Loading your account"
    >
      <div className="h-3 w-24 animate-pulse rounded bg-white/8" />
      <div className="mt-3 h-9 w-56 animate-pulse rounded bg-white/8" />
      <div className="mt-8 grid gap-4">
        <div className="sign h-40 animate-pulse" />
        <div className="sign h-28 animate-pulse" />
        <div className="sign h-52 animate-pulse" />
      </div>
    </main>
  );
}
