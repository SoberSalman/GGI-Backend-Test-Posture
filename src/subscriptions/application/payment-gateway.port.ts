export interface ChargeRequest {
  userId: string;
  subscriptionId: string;
  amountCents: number;
  description: string;
}

export type ChargeResult =
  | { readonly outcome: 'SUCCEEDED'; readonly reference: string }
  | { readonly outcome: 'FAILED'; readonly reason: string };

/** Swap point for a real PSP; a random-failure simulator sits here for now. */
export abstract class PaymentGateway {
  abstract charge(request: ChargeRequest): Promise<ChargeResult>;
}
