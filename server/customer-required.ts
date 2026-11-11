// A key that requires an end customer (FOL-168): every run it starts must
// name one — a partner's guard that no run slips past its per-customer
// limits and blocks by leaving `customer` out. 400, code customer_required.

import type { Actor } from "@/server/auth";

export class CustomerRequired extends Error {
  readonly status = 400;
  readonly code = "customer_required";
}

/** Throws CustomerRequired when the caller's key requires a customer and none was named. */
export function assertCustomerNamed(actor: Pick<Actor, "requireCustomer">, customer: string | undefined): void {
  if (actor.requireCustomer && !customer) throw new CustomerRequired("this key requires an end customer on every run — send customer (an opaque id for which of your users it is for)");
}
