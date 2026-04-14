import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { getStripe } from '@/server/billing/stripe';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const stripe = getStripe();

  // Reuse stripe_customer_id when present.
  const profileRes = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single<{ stripe_customer_id: string | null }>();
  let customerId = profileRes.data?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    const admin = createAdminClient();
    await admin
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: env.STRIPE_PRICE_ID_MONTHLY, quantity: 1 }],
    success_url: `${env.NEXT_PUBLIC_SITE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_SITE_URL}/billing/cancel`,
    client_reference_id: user.id,
  });

  return NextResponse.json({ url: session.url });
}
