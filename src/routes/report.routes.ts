import { Router } from 'express';
import * as reportController from '../controllers/report.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

/**
 * Enterprise Reports & Analytics Endpoints
 * Protected by JWT authentication and role authorization (ADMIN, STAFF, CASHIER)
 */
// Consolidated Master Audit Endpoints (Must precede /:module parameter)
router.get(
  '/consolidated/data',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER'),
  reportController.getConsolidatedReportData
);

router.get(
  '/consolidated/pdf',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER'),
  reportController.downloadConsolidatedReportPdf
);

// Dedicated Financial Audit & Operational Revenue Summary Endpoints
router.get(
  '/financial-audit/data',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER'),
  reportController.getFinancialAuditData
);

router.get(
  '/financial-audit/pdf',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER'),
  reportController.downloadFinancialAuditPdf
);

router.get(
  '/:module/data',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER'),
  reportController.getReportData
);

router.get(
  '/:module/pdf',
  verifyToken,
  requireRole('ADMIN', 'STAFF', 'CASHIER'),
  reportController.downloadReportPdf
);

export default router;
