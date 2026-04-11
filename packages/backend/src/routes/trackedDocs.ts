import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../config/firebase';
import type { TrackedDoc } from '@doc-align/shared';
import { canTrackDocument } from '@doc-align/shared';

const router: RouterType = Router();

// GET / — list tracked docs for current user
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const snap = await db.collection('trackedDocs')
      .where('userId', '==', req.userId)
      .orderBy('trackedAt', 'desc')
      .get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(docs);
  } catch (err) {
    console.error('Error listing tracked docs:', err);
    res.status(500).json({ error: 'Failed to list tracked docs' });
  }
});

// POST / — track a document
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { documentId, title, baselineRevisionId } = req.body;
    if (!documentId || !title) {
      res.status(400).json({ error: 'documentId and title are required' });
      return;
    }

    // Check tier limit
    const userDoc = await db.collection('users').doc(req.userId!).get();
    const tier = userDoc.exists ? (userDoc.data()!.tier || 'free') : 'free';
    const existing = await db.collection('trackedDocs')
      .where('userId', '==', req.userId)
      .get();
    if (!canTrackDocument(tier, existing.size)) {
      res.status(403).json({ error: 'Tracking limit reached' });
      return;
    }

    const tracked: Omit<TrackedDoc, 'id'> = {
      documentId,
      userId: req.userId!,
      title,
      baselineRevisionId: baselineRevisionId || '',
      trackedAt: new Date().toISOString(),
    };
    const ref = await db.collection('trackedDocs').add(tracked);
    res.json({ id: ref.id, ...tracked });
  } catch (err) {
    console.error('Error tracking doc:', err);
    res.status(500).json({ error: 'Failed to track document' });
  }
});

// GET /:docId/status — check if a doc is tracked
router.get('/:docId/status', async (req: AuthenticatedRequest, res) => {
  try {
    const snap = await db.collection('trackedDocs')
      .where('userId', '==', req.userId)
      .where('documentId', '==', req.params.docId)
      .limit(1)
      .get();
    res.json({ tracked: !snap.empty });
  } catch (err) {
    console.error('Error checking tracked status:', err);
    res.status(500).json({ error: 'Failed to check tracked status' });
  }
});

// DELETE /:docId — untrack a document
router.delete('/:docId', async (req: AuthenticatedRequest, res) => {
  try {
    const snap = await db.collection('trackedDocs')
      .where('userId', '==', req.userId)
      .where('documentId', '==', req.params.docId)
      .get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    console.error('Error untracking doc:', err);
    res.status(500).json({ error: 'Failed to untrack document' });
  }
});

export default router;
