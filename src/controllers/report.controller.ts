import type { Request, Response } from 'express';
import { reportService, resolveDateFilter, type ReportModule } from '../services/report.service.ts';
import { ReportPdfService } from '../services/report-pdf.service.ts';
import { auditService } from '../services/audit.service.ts';
import { HttpException } from '../middleware/error.middleware.ts';

const VALID_MODULES: ReportModule[] = [
  'sales',
  'returns',
  'inventory',
  'products',
  'materials',
  'production',
  'suppliers',
  'audit',
  'cheques',
  'expenses',
];

/**
 * Controller handling report data extraction and streamed PDF generation
 */
export async function getReportData(req: Request, res: Response): Promise<void> {
  const rawParam = Array.isArray(req.params.module) ? req.params.module[0] : req.params.module;
  const moduleParam = String(rawParam || '').toLowerCase() as ReportModule;

  if (!VALID_MODULES.includes(moduleParam)) {
    throw new HttpException(400, `Invalid report module '${moduleParam}'. Valid modules: ${VALID_MODULES.join(', ')}`);
  }

  const userRole = String(req.user?.role || '').toUpperCase();
  if (userRole === 'REP' && moduleParam !== 'sales') {
    throw new HttpException(403, 'Forbidden: Representatives are strictly restricted to viewing their own sales reports.');
  }

  const dateFilter = resolveDateFilter({
    preset: req.query.preset as string,
    startDate: (req.query.startDate || req.query.from) as string,
    endDate: (req.query.endDate || req.query.to) as string,
    from: req.query.from as string,
    to: req.query.to as string,
  });

  const queryRepId = req.query.repUserId || req.query.userId;
  const cleanRepId = queryRepId && !isNaN(Number(queryRepId)) && Number(queryRepId) > 0 ? Number(queryRepId) : undefined;
  const effectiveRepUserId = userRole === 'REP' ? Number(req.user?.userId) : cleanRepId;
  const queryCategoryId = req.query.categoryId && req.query.categoryId !== 'all' ? Number(req.query.categoryId) : undefined;
  const querySubCategoryId = req.query.subCategoryId && req.query.subCategoryId !== 'all' ? Number(req.query.subCategoryId) : undefined;
  const queryStage = req.query.stage ? String(req.query.stage) : undefined;
  const queryViewMode = req.query.viewMode ? String(req.query.viewMode) : undefined;
  const report = await reportService.getReportData(moduleParam, dateFilter, effectiveRepUserId, queryCategoryId, querySubCategoryId, queryStage, queryViewMode);

  res.status(200).json({
    success: true,
    data: report,
  });
}

/**
 * Builds a descriptive, conflict-free production PDF filename reflecting
 * the active stage filter, viewMode, and date range.
 */
function buildBackendProductionFilename(
  stageFilter?: string,
  viewMode?: string,
  startDate?: Date,
  endDate?: Date
): string {
  const normStage = String(stageFilter || 'ALL STAGES').toUpperCase();
  const stageSlugMap: Record<string, string> = {
    'ALL': 'full-report',
    'ALL STAGES': 'full-report',
    'CUTTING': 'cutting',
    'SEWING LINE': 'sewing-line',
    'SEWING': 'sewing-line',
    'LINE': 'sewing-line',
    'SEWING_SEWN': 'sewn-output',
    'SEWING_WASH_READY': 'wash-ready',
    'WASHING': 'washing',
    'WASH': 'washing',
    'FINISHING / PACKING': 'finishing-packing',
    'FINISHING': 'finishing-packing',
    'PACKING': 'finishing-packing',
    'IN STOCK / COMPLETED': 'completed-stock',
    'COMPLETED': 'completed-stock',
    'IN STOCK': 'completed-stock',
  };
  const stageSlug = stageSlugMap[normStage] || normStage.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const normView = String(viewMode || 'all').toLowerCase() === 'active' ? 'current' : 'all';
  const isUnfilteredAll = stageSlug === 'full-report' && normView === 'all';
  const viewPart = isUnfilteredAll ? '' : `-${normView}`;
  const startYmd = startDate ? startDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const endYmd = endDate ? endDate.toISOString().split('T')[0] : startYmd;
  return `reliance-production-${stageSlug}${viewPart}-${startYmd}-to-${endYmd}.pdf`;
}

/**
 * Controller handling streamed PDF report export
 */
export async function downloadReportPdf(req: Request, res: Response): Promise<void> {
  const rawParam = Array.isArray(req.params.module) ? req.params.module[0] : req.params.module;
  const moduleParam = String(rawParam || '').toLowerCase() as ReportModule;

  if (!VALID_MODULES.includes(moduleParam)) {
    throw new HttpException(400, `Invalid report module '${moduleParam}'. Valid modules: ${VALID_MODULES.join(', ')}`);
  }

  const userRole = String(req.user?.role || '').toUpperCase();
  if (userRole === 'REP' && moduleParam !== 'sales') {
    throw new HttpException(403, 'Forbidden: Representatives are strictly restricted to downloading their own sales reports.');
  }

  const dateFilter = resolveDateFilter({
    preset: req.query.preset as string,
    startDate: (req.query.startDate || req.query.from) as string,
    endDate: (req.query.endDate || req.query.to) as string,
    from: req.query.from as string,
    to: req.query.to as string,
  });

  const queryRepId = req.query.repUserId || req.query.userId;
  const cleanRepId = queryRepId && !isNaN(Number(queryRepId)) && Number(queryRepId) > 0 ? Number(queryRepId) : undefined;
  const effectiveRepUserId = userRole === 'REP' ? Number(req.user?.userId) : cleanRepId;
  const queryCategoryId = req.query.categoryId && req.query.categoryId !== 'all' ? Number(req.query.categoryId) : undefined;
  const querySubCategoryId = req.query.subCategoryId && req.query.subCategoryId !== 'all' ? Number(req.query.subCategoryId) : undefined;
  const queryStage = req.query.stage ? String(req.query.stage) : undefined;
  const queryViewMode = req.query.viewMode ? String(req.query.viewMode) : undefined;
  const report = await reportService.getReportData(moduleParam, dateFilter, effectiveRepUserId, queryCategoryId, querySubCategoryId, queryStage, queryViewMode);
  const pdfDoc = ReportPdfService.generate(moduleParam, report, req.user, queryStage);

  const dateTag = dateFilter.startDate.toISOString().split('T')[0];
  const filename =
    moduleParam === 'production'
      ? buildBackendProductionFilename(queryStage, queryViewMode, dateFilter.startDate, dateFilter.endDate)
      : `reliance-${moduleParam}-report-${dateTag}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  pdfDoc.pipe(res);
  pdfDoc.end();
}

/**
 * Controller handling Consolidated Master Audit data extraction
 */
export async function getConsolidatedReportData(req: Request, res: Response): Promise<void> {
  const dateFilter = resolveDateFilter({
    preset: req.query.preset as string,
    startDate: (req.query.startDate || req.query.from) as string,
    endDate: (req.query.endDate || req.query.to) as string,
    from: req.query.from as string,
    to: req.query.to as string,
  });

  const report = await reportService.getConsolidatedReportData(dateFilter);

  res.status(200).json({
    success: true,
    data: report,
  });
}

/**
 * Controller handling streamed Consolidated Master Audit PDF report export
 */
export async function downloadConsolidatedReportPdf(req: Request, res: Response): Promise<void> {
  const dateFilter = resolveDateFilter({
    preset: req.query.preset as string,
    startDate: (req.query.startDate || req.query.from) as string,
    endDate: (req.query.endDate || req.query.to) as string,
    from: req.query.from as string,
    to: req.query.to as string,
  });

  const consolidatedReport = await reportService.getConsolidatedReportData(dateFilter);
  const pdfDoc = ReportPdfService.generateConsolidated(consolidatedReport, req.user);

  const dateTag = dateFilter.startDate.toISOString().split('T')[0];
  const filename = `reliance-consolidated-master-report-${dateTag}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  pdfDoc.pipe(res);
  pdfDoc.end();
}

/**
 * Controller handling Financial Audit & Operational Revenue data calculation
 */
export async function getFinancialAuditData(req: Request, res: Response): Promise<void> {
  const auditData = await auditService.getFinancialAuditData({
    preset: req.query.preset as string,
    startDate: (req.query.startDate || req.query.from) as string,
    endDate: (req.query.endDate || req.query.to) as string,
  });

  res.status(200).json({
    success: true,
    data: auditData,
  });
}

/**
 * Controller handling streamed Master Financial Audit PDF summary export
 */
export async function downloadFinancialAuditPdf(req: Request, res: Response): Promise<void> {
  const auditData = await auditService.getFinancialAuditData({
    preset: req.query.preset as string,
    startDate: (req.query.startDate || req.query.from) as string,
    endDate: (req.query.endDate || req.query.to) as string,
  });

  const pdfDoc = auditService.generateMasterAuditPdf(auditData, req.user);
  const dateTag = auditData.dateFilter.startDate.toISOString().split('T')[0];
  const filename = `reliance-master-financial-audit-${dateTag}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  pdfDoc.pipe(res);
  pdfDoc.end();
}
