import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <h1 className="text-lg font-semibold">Sign-in link expired</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That magic link is no longer valid. Request a new one to sign back in.
      </p>
      <Link
        href="/login"
        className="text-sm font-medium underline underline-offset-4"
      >
        Back to login
      </Link>
    </div>
  );
}
