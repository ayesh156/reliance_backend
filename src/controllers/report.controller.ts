import type { Request, Response } from 'express';
import { reportService, resolveDateFilter, type ReportModule } from '../services/report.service.ts';
import { ReportPdfService } from '../services/report-pdf.service.ts';
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

  const dateFilter = resolveDateFilter({
    preset: req.query.preset as string,
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
  });

  const report = await reportService.getReportData(moduleParam, dateFilter);

  res.status(200).json({
    success: true,
    data: report,
  });
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

  const dateFilter = resolveDateFilter({
    preset: req.query.preset as string,
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
  });

  const report = await reportService.getReportData(moduleParam, dateFilter);
  const pdfDoc = ReportPdfService.generate(moduleParam, report, req.user);

  const dateTag = dateFilter.startDate.toISOString().split('T')[0];
  const filename = `reliance-${moduleParam}-report-${dateTag}.pdf`;

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
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
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
    startDate: req.query.startDate as string,
    endDate: req.query.endDate as string,
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
