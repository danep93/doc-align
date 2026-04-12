import { Router } from 'express';
import type { Router as RouterType } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { checkPermission } from '../lib/permissions';
import { getOrgRole } from '../lib/permissions';
import { UpdateSignoffRulesSchema, AddOrgDocumentSchema } from '@doc-align/shared';
import {
  getOrgDefaultRules,
  setOrgDefaultRules,
  getEffectiveRules,
  setDocRules,
  resetDocRules,
  addOrgDocument,
  getOrgDocuments,
  removeOrgDocument,
  getRuleStatus,
} from '../services/signoffRulesService';

const router: RouterType = Router({ mergeParams: true });

// GET / — get org default rules
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const role = await getOrgRole(req.userId!, orgId);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const rules = await getOrgDefaultRules(orgId);
    res.json(rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PUT / — set org default rules
router.put('/', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = UpdateSignoffRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    const rules = await setOrgDefaultRules(orgId, parsed.data.rules, req.userId!);
    res.json(rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// POST /documents — add document to org (any member)
router.post('/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const role = await getOrgRole(req.userId!, orgId);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = AddOrgDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    const doc = await addOrgDocument(orgId, parsed.data.documentId, parsed.data.title, req.userId!);
    res.status(201).json(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /documents — list org documents (any member)
router.get('/documents', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const role = await getOrgRole(req.userId!, orgId);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const docs = await getOrgDocuments(orgId);
    res.json(docs);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /documents/:documentId/status — get rule fulfillment status
router.get('/documents/:documentId/status', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const documentId = req.params.documentId!;
    const role = await getOrgRole(req.userId!, orgId);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const status = await getRuleStatus(orgId, documentId);
    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// GET /documents/:documentId — get effective rules for document
router.get('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const documentId = req.params.documentId!;
    const role = await getOrgRole(req.userId!, orgId);
    if (!role) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const rules = await getEffectiveRules(orgId, documentId);
    res.json(rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// PUT /documents/:documentId — update document rules
router.put('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const documentId = req.params.documentId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    const parsed = UpdateSignoffRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid data', details: parsed.error.issues });
      return;
    }

    const rules = await setDocRules(orgId, documentId, parsed.data.rules, req.userId!);
    res.json(rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// DELETE /documents/:documentId — reset doc rules to org defaults / remove from org
router.delete('/documents/:documentId', async (req: AuthenticatedRequest, res) => {
  try {
    const orgId = req.params.orgId!;
    const documentId = req.params.documentId!;
    const allowed = await checkPermission({
      userId: req.userId!,
      orgId,
      action: 'org:edit',
    });
    if (!allowed) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    await resetDocRules(orgId, documentId);
    await removeOrgDocument(orgId, documentId);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

export default router;
