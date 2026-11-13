import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.ts';
import { sendSuccess, sendError, sendErrorFrom } from '../utils/response.ts';

/**
 * Controller handling Expenses and Expense Categories.
 * Provides endpoints for managing categories, expenses ledger, and period totals.
 */
export class ExpenseController {
  /**
   * GET /api/expenses/categories
   * List all expense categories sorted alphabetically.
   */
  async getCategories(_req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await prisma.expenseCategory.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { expenses: true },
          },
        },
      });
      return sendSuccess(res, categories);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/expenses/categories
   * Create a new expense category.
   */
  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, description } = req.body;
      const cleanName = typeof name === 'string' ? name.trim() : '';

      if (!cleanName) {
        return sendError(res, 'Category name is required', 400);
      }

      // Check if existing category with same name exists (case-insensitive)
      const existing = await prisma.expenseCategory.findFirst({
        where: { name: cleanName },
      });

      if (existing) {
        if (!existing.isActive) {
          // Re-activate if was deactivated
          const reactivated = await prisma.expenseCategory.update({
            where: { id: existing.id },
            data: { isActive: true, description: description?.trim() || existing.description },
          });
          return sendSuccess(res, reactivated, 200);
        }
        return sendError(res, `Expense category '${cleanName}' already exists`, 409);
      }

      const category = await prisma.expenseCategory.create({
        data: {
          name: cleanName,
          description: typeof description === 'string' ? description.trim() : null,
          isActive: true,
        },
      });

      return sendSuccess(res, category, 201);
    } catch (err) {
      sendErrorFrom(res, err, 'Failed to create expense category');
    }
  }

  /**
   * GET /api/expenses
   * List expenses with optional date range, categoryId, and search filtering.
   */
  async getExpenses(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, categoryId, search } = req.query;

      const where: any = {};

      // Date filtering
      if (startDate || endDate) {
        where.date = {};
        if (startDate) {
          const start = new Date(String(startDate));
          if (!isNaN(start.getTime())) {
            start.setHours(0, 0, 0, 0);
            where.date.gte = start;
          }
        }
        if (endDate) {
          const end = new Date(String(endDate));
          if (!isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            where.date.lte = end;
          }
        }
      }

      // Category filter
      if (categoryId && categoryId !== 'all') {
        const catId = parseInt(String(categoryId), 10);
        if (!isNaN(catId) && catId > 0) {
          where.categoryId = catId;
        }
      }

      // Search filter across code, description, or category name
      if (typeof search === 'string' && search.trim()) {
        const term = search.trim();
        where.OR = [
          { code: { contains: term } },
          { description: { contains: term } },
          { category: { name: { contains: term } } },
        ];
      }

      const expenses = await prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        include: {
          category: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      // Calculate aggregate totals
      const totalAmount = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      const transactionCount = expenses.length;

      // Group category totals for quick KPI insights
      const categoryTotals: Record<string, { count: number; total: number; name: string }> = {};
      for (const exp of expenses) {
        const catName = exp.category?.name || 'Uncategorized';
        if (!categoryTotals[catName]) {
          categoryTotals[catName] = { count: 0, total: 0, name: catName };
        }
        categoryTotals[catName].count += 1;
        categoryTotals[catName].total += Number(exp.amount || 0);
      }

      const summary = {
        totalAmount: Math.round(totalAmount * 100) / 100,
        transactionCount,
        categoryCount: Object.keys(categoryTotals).length,
        categoryBreakdown: Object.values(categoryTotals).sort((a, b) => b.total - a.total),
      };

      return sendSuccess(res, {
        expenses,
        summary,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Helper to generate the next sequential EXP-XXXX code.
   */
  private async getNextExpenseCode(): Promise<string> {
    const latest = await prisma.expense.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true, code: true },
    });

    if (!latest) {
      return 'EXP-0001';
    }

    const match = latest.code?.match(/EXP-(\d+)/i);
    if (match) {
      const nextNum = parseInt(match[1], 10) + 1;
      return `EXP-${String(nextNum).padStart(4, '0')}`;
    }

    const nextId = (latest.id || 0) + 1;
    return `EXP-${String(nextId).padStart(4, '0')}`;
  }

  /**
   * POST /api/expenses
   * Create a new expense record with auto-generated sequential code.
   */
  async createExpense(req: Request, res: Response, _next: NextFunction) {
    try {
      const { code, date, categoryId, description, amount } = req.body;

      const catId = parseInt(String(categoryId), 10);
      if (!catId || isNaN(catId) || catId <= 0) {
        return sendError(res, 'Valid expense category is required', 400);
      }

      const cleanDescription = typeof description === 'string' ? description.trim() : '';
      if (!cleanDescription) {
        return sendError(res, 'Expense description is required', 400);
      }

      const numAmount = parseFloat(String(amount));
      if (isNaN(numAmount) || numAmount <= 0) {
        return sendError(res, 'Expense amount must be a positive number', 400);
      }

      // Verify category existence
      const category = await prisma.expenseCategory.findUnique({
        where: { id: catId },
      });
      if (!category) {
        return sendError(res, 'Selected expense category not found', 404);
      }

      // Generate or validate expense code
      let finalCode = typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : '';
      if (!finalCode) {
        finalCode = await this.getNextExpenseCode();
      } else {
        const existingCode = await prisma.expense.findUnique({
          where: { code: finalCode },
        });
        if (existingCode) {
          return sendError(res, `Expense with code '${finalCode}' already exists`, 409);
        }
      }

      // Resolve expense date
      let expenseDate = new Date();
      if (date) {
        const parsedDate = new Date(String(date));
        if (!isNaN(parsedDate.getTime())) {
          expenseDate = parsedDate;
        }
      }

      const createdById = req.user?.userId ? Number(req.user.userId) : null;

      const newExpense = await prisma.expense.create({
        data: {
          code: finalCode,
          date: expenseDate,
          categoryId: catId,
          description: cleanDescription,
          amount: Math.round(numAmount * 100) / 100,
          createdById,
        },
        include: {
          category: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      return sendSuccess(res, newExpense, 201);
    } catch (err) {
      sendErrorFrom(res, err, 'Failed to record expense');
    }
  }

  /**
   * PUT /api/expenses/:id
   * Update an existing expense record.
   */
  async updateExpense(req: Request, res: Response, _next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return sendError(res, 'Valid expense ID is required', 400);
      }

      const { code, date, categoryId, description, amount } = req.body;

      const existing = await prisma.expense.findUnique({
        where: { id },
      });
      if (!existing) {
        return sendError(res, 'Expense record not found', 404);
      }

      const updateData: any = {};

      if (categoryId !== undefined) {
        const catId = parseInt(String(categoryId), 10);
        if (isNaN(catId) || catId <= 0) {
          return sendError(res, 'Valid expense category ID is required', 400);
        }
        const category = await prisma.expenseCategory.findUnique({ where: { id: catId } });
        if (!category) {
          return sendError(res, 'Expense category not found', 404);
        }
        updateData.categoryId = catId;
      }

      if (description !== undefined) {
        const cleanDesc = typeof description === 'string' ? description.trim() : '';
        if (!cleanDesc) {
          return sendError(res, 'Expense description cannot be empty', 400);
        }
        updateData.description = cleanDesc;
      }

      if (amount !== undefined) {
        const numAmount = parseFloat(String(amount));
        if (isNaN(numAmount) || numAmount <= 0) {
          return sendError(res, 'Expense amount must be a positive number', 400);
        }
        updateData.amount = Math.round(numAmount * 100) / 100;
      }

      if (date !== undefined) {
        const parsedDate = new Date(String(date));
        if (isNaN(parsedDate.getTime())) {
          return sendError(res, 'Valid date format is required', 400);
        }
        updateData.date = parsedDate;
      }

      if (code !== undefined) {
        const cleanCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
        if (cleanCode && cleanCode !== existing.code) {
          const codeTaken = await prisma.expense.findUnique({ where: { code: cleanCode } });
          if (codeTaken) {
            return sendError(res, `Expense code '${cleanCode}' is already in use`, 409);
          }
          updateData.code = cleanCode;
        }
      }

      const updated = await prisma.expense.update({
        where: { id },
        data: updateData,
        include: {
          category: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: { id: true, name: true, role: true },
          },
        },
      });

      return sendSuccess(res, updated);
    } catch (err) {
      sendErrorFrom(res, err, 'Failed to update expense');
    }
  }

  /**
   * DELETE /api/expenses/:id
   * Remove an expense record.
   */
  async deleteExpense(req: Request, res: Response, _next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return sendError(res, 'Valid expense ID is required', 400);
      }

      const existing = await prisma.expense.findUnique({ where: { id } });
      if (!existing) {
        return sendError(res, 'Expense record not found', 404);
      }

      await prisma.expense.delete({ where: { id } });

      return sendSuccess(res, {
        success: true,
        message: `Expense '${existing.code}' removed successfully`,
      });
    } catch (err) {
      sendErrorFrom(res, err, 'Failed to delete expense');
    }
  }
}

export const expenseController = new ExpenseController();
export default expenseController;

