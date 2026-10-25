// "I forgot my password." One field; the answer is the same whatever you
// type, because this page must not be a way to learn who has an account.
import { ForgotForm } from "./form";
import { Brand } from "../brand";

export const metadata = { title: "Reset your password — foldrun" };

export default function ForgotPage() {
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Brand />
        <h1 className="mb-1 text-lg font-semibold text-fg">Reset your password</h1>
      <p className="mb-6 text-sm text-fg-muted">Enter your email and we will send a link that works once, for 30 minutes.</p>
      <ForgotForm />
      <p className="mt-6 text-center text-xs text-fg-muted"><a href="/login" className="hover:text-fg">Back to sign in</a></p>
    </main>
  );
}
