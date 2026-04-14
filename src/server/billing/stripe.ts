import Stripe from 'stripe';
import { env } from '@/lib/env';

let client: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      // Pin to the SDK's bundled API version (avoids drift between deploys).
      typescript: true,
    });
  }
  return client;
};

export const __resetStripeForTests = (): void => {
  client = null;
};
