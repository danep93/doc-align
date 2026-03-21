import { Router } from 'express';
import type { Router as RouterType, Request } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { stripe } from '../config/stripe';
import { updateUserTier } from '../services/userService';

const router: RouterType = Router();

const PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRO_PRICE_ID || '',
  enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID || '',
};

router.post('/checkout', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { plan } = req.body;
  if (!plan || !PRICE_IDS[plan]) {
    res.status(400).json({ error: 'Invalid plan' });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL || 'https://doc-align.app'}/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://doc-align.app'}/cancel`,
      metadata: { userId: req.userId! },
    });
    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/webhook', async (req: Request, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || '',
    );
  } catch {
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const customerId = session.customer as string;
    if (userId) {
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = sub.items.data[0]?.price.id;
      const tier = Object.entries(PRICE_IDS).find(([, id]) => id === priceId)?.[0] || 'pro';
      await updateUserTier(userId, tier, customerId);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const customerId = sub.customer as string;
    // Find user by stripe customer ID and downgrade
    const { db } = await import('../config/firebase');
    const snapshot = await db.collection('users').where('stripeCustomerId', '==', customerId).get();
    if (!snapshot.empty) {
      await snapshot.docs[0]!.ref.update({ tier: 'free' });
    }
  }

  res.json({ received: true });
});

export default router;
