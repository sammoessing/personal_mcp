import { Suspense } from "react";
import { LoginForm } from "./login-form";

/**
 * The form reads `next` from the query string via useSearchParams, which Next
 * requires to sit inside a Suspense boundary so the page can still be
 * statically prerendered.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginForm />
    </Suspense>
  );
}
