export interface ChargeRequest {
  userId: string;
  subscriptionId: string;
  amountCents: number;
  description: string;
}

export type ChargeResult =
  | { readonly outcome: 'SUCCEEDED'; readonly reference: string }
  | { readonly outcome: 'FAILED'; readonly reason: string };

/**
 * Outbound port for taking money.
 *
 * The application layer depends on this abstraction only; the assessment ships
 * a random-failure simulator behind it, and a real PSP adapter would slot into
 * the same contract without touching a single service.
 */
export abstract class PaymentGateway {
  abstract charge(request: ChargeRequest): Promise<ChargeResult>;
}
