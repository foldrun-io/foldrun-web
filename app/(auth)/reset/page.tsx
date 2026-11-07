// The reset link lands here with its token; a new password signs you in.
import { ResetForm } from "./form";
import { AuthCard } from "../brand";
import { Callout } from "@/components/kit/page";

export const metadata = { title: "Choose a new password — foldrun" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthCard title="Choose a new password" hint="At least 10 characters. Every other session of yours will be signed out.">
      {token ? <ResetForm token={token} /> : <Callout tone="danger">This link is missing its token — open it from the email.</Callout>}
    </AuthCard>
  );
}
