import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/server/billing/stripe';
import { env } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
// Stripe webhook MUST receive the raw body — do not transform.
export const dynamic = 'force-dynamic';

const recordPlanChange = async (
  admin: ReturnType<typeof createAdminClient>,
  args: {
    userId: string;
    fromPlan: string;
    toPlan: string;
    eventId: string;
  },
): Promise<{ alreadyProcessed: boolean }> => {
  const insert = await admin.from('plan_changes').insert({
    user_id: args.userId,
    from_plan: args.fromPlan,
    to_plan: args.toPlan,
    stripe_event_id: args.eventId,
  });
  if (insert.error) {
    // Unique violation on stripe_event_id == replay -> ignore.
    if ((insert.error as { code?: string }).code === '23505') {
      return { alreadyProcessed: true };
    }
    throw new Error(`plan_changes insert failed: ${insert.error.message}`);
  }
  return { alreadyProcessed: false };
};

const userIdForCustomer = async (
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
): Promise<string | null> => {
  const r = await admin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single<{ id: string }>();
  return r.data?.id ?? null;
};

export async function POST(request: Request): Promise<NextResponse> {
  const stripe = getStripe();
  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }
  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      {
        error: `signature verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = (session.client_reference_id ?? null) as string | null;
      if (!userId) {
        return NextResponse.json({ received: true, skipped: 'no_user_id' });
      }
      const { alreadyProcessed } = await recordPlanChange(admin, {
        userId,
        fromPlan: 'free',
        toPlan: 'paid',
        eventId: event.id,
      });
      if (!alreadyProcessed) {
        await admin
          .from('profiles')
          .update({
            plan: 'paid',
            stripe_customer_id:
              typeof session.customer === 'string' ? session.customer : null,
          })
          .eq('id', userId);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      const userId = await userIdForCustomer(admin, customerId);
      if (!userId) {
        return NextResponse.json({ received: true, skipped: 'no_profile' });
      }
      const { alreadyProcessed } = await recordPlanChange(admin, {
        userId,
        fromPlan: 'paid',
        toPlan: 'free',
        eventId: event.id,
      });
      if (!alreadyProcessed) {
        await admin.from('profiles').update({ plan: 'free' }).eq('id', userId);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
