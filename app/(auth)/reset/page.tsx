// The reset link lands here with its token; a new password signs you in.
import { ResetForm } from "./form";
import { Brand } from "../brand";

export const metadata = { title: "Choose a new password — foldrun" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <Brand />
        <h1 className="mb-1 text-lg font-semibold text-fg">Choose a new password</h1>
      <p className="mb-6 text-sm text-fg-muted">At least 10 characters. Every other session of yours will be signed out.</p>
      {token ? <ResetForm token={token} /> : <p className="text-sm text-red-700">This link is missing its token — open it from the email.</p>}
    </main>
  );
}
