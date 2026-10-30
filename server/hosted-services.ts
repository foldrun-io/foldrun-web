// What the hosted app starts beside itself once booted (instrumentation.ts).
//
// foldrun's hosted platform runs services of its own beside the app
// (foldrun-admin); the public edition has none, so as this repository has
// it this starts nothing. The hosted build replaces it (foldrun-admin
// overlay.sh).

export async function startHostedServices(): Promise<void> {}
