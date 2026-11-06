// "I forgot my password." One field; the answer is the same whatever you
// type, because this page must not be a way to learn who has an account.
import { ForgotForm } from "./form";
import { AuthCard } from "../brand";

export const metadata = { title: "Reset your password — foldrun" };

export default function ForgotPage() {
  return (
    <AuthCard
      title="Reset your password"
      hint="Enter your email and we will send a link that works once, for 30 minutes."
      footer={
        <a href="/login" className="hover:text-fg">
          Back to sign in
        </a>
      }
    >
      <ForgotForm />
    </AuthCard>
  );
}
