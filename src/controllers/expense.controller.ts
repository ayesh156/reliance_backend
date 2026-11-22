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
   * List expense categories with nested 2-level hierarchy (Primary Categories + Sub-Categories).
   * Supports ?flat=true for flat listing or returns Primary Categories with nested subCategories by default.
   */
  async getCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { flat } = req.query;

      const where: any = { isActive: true };
      if (flat !== 'true') {
        where.parentId = null;
      }

      const categories = await prisma.expenseCategory.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          parent: {
            select: { id: true, name: true },
          },
          subCategories: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            include: {
              parent: {
                select: { id: true, name: true },
              },
              _count: {
                select: { expenses: true, subExpenses: true },
              },
            },
          },
          _count: {
            select: { expenses: true, subExpenses: true, subCategories: true },
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
   * Create a new Primary Category or Sub-Category with scoped uniqueness validation.
   */
  async createCategory(req: Request, res: Response, _next: NextFunction) {
    try {
      const { name, parentId, description, level } = req.body;
      const cleanName = typeof name === 'string' ? name.trim() : '';

      if (!cleanName) {
        return sendError(res, 'Category name is required', 400);
      }

      let parsedParentId: number | null = null;
      if (parentId !== undefined && parentId !== null && parentId !== '' && parentId !== 'none' && parentId !== 0 && parentId !== '0') {
        parsedParentId = parseInt(String(parentId), 10);
        if (isNaN(parsedParentId) || parsedParentId <= 0) {
          return sendError(res, 'Valid parent category ID is required', 400);
        }

        // Verify parent exists and is itself a Primary Category (parentId === null)
        const parentCategory = await prisma.expenseCategory.findUnique({
          where: { id: parsedParentId },
        });

        if (!parentCategory) {
          return sendError(res, 'Parent category not found', 404);
        }

        if (parentCategory.parentId !== null) {
          return sendError(res, 'Cannot nest sub-categories more than 2 levels deep', 400);
        }
      }

      // Explicit level validation guardrail
      if (level === 'sub' && (!parsedParentId || parsedParentId <= 0)) {
        return sendError(res, 'Parent Primary Category is required for a sub-category', 400);
      }
      if (level === 'primary') {
        parsedParentId = null;
      }

      // Check scoped uniqueness (case-insensitive) within the same parent scope
      const existing = await prisma.expenseCategory.findFirst({
        where: {
          name: cleanName,
          parentId: parsedParentId,
        },
      });

      const cleanDescription = typeof description === 'string' ? description.trim() : null;

      if (existing) {
        if (!existing.isActive) {
          // Re-activate previously deactivated category
          const reactivated = await prisma.expenseCategory.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              description: cleanDescription !== null ? cleanDescription : existing.description,
            },
            include: {
              parent: {
                select: { id: true, name: true },
              },
              subCategories: {
                where: { isActive: true },
                orderBy: { name: 'asc' },
              },
              _count: {
                select: { expenses: true, subExpenses: true },
              },
            },
          });
          return sendSuccess(res, reactivated, 200);
        }
        return sendError(
          res,
          parsedParentId
            ? `Sub-category '${cleanName}' already exists under this primary category`
            : `Primary category '${cleanName}' already exists`,
          409
        );
      }

      const category = await prisma.expenseCategory.create({
        data: {
          name: cleanName,
          parentId: parsedParentId,
          description: cleanDescription,
          isActive: true,
        },
        include: {
          parent: {
            select: { id: true, name: true },
          },
          subCategories: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
          },
          _count: {
            select: { expenses: true, subExpenses: true },
          },
        },
      });

      return sendSuccess(res, category, 201);
    } catch (err) {
      sendErrorFrom(res, err, 'Failed to create expense category');
    }
  }

  /**
   * PUT / PATCH /api/expenses/categories/:id
   * Update category name, description (optional), and parent hierarchy.
   */
  async updateCategory(req: Request, res: Response, _next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return sendError(res, 'Valid category ID is required', 400);
      }

      const existing = await prisma.expenseCategory.findUnique({
        where: { id },
        include: {
          subCategories: { where: { isActive: true } },
        },
      });

      if (!existing) {
        return sendError(res, 'Expense category not found', 404);
      }

      const { name, description, parentId, level } = req.body;
      const updateData: any = {};

      let targetParentId = existing.parentId;

      // Handle parentId changes
      if (parentId !== undefined) {
        if (parentId === null || parentId === '' || parentId === 'none' || parentId === 0 || parentId === '0') {
          targetParentId = null;
        } else {
          const parsedParentId = parseInt(String(parentId), 10);
          if (isNaN(parsedParentId) || parsedParentId <= 0) {
            return sendError(res, 'Valid parent category ID is required', 400);
          }

          // Prevent circular reference
          if (parsedParentId === id) {
            return sendError(res, 'A category cannot be its own parent category', 400);
          }

          // Prevent demoting a Primary Category that already owns child Sub-Categories
          if (existing.parentId === null && existing.subCategories.length > 0) {
            return sendError(
              res,
              'Cannot convert a primary category with active sub-categories into a sub-category. Remove or reassign its sub-categories first.',
              400
            );
          }

          // Verify target parent exists and is a Primary Category (parentId === null)
          const targetParent = await prisma.expenseCategory.findUnique({
            where: { id: parsedParentId },
          });

          if (!targetParent) {
            return sendError(res, 'Parent category not found', 404);
          }

          if (targetParent.parentId !== null) {
            return sendError(res, 'Cannot nest sub-categories more than 2 levels deep', 400);
          }

          targetParentId = parsedParentId;
        }
        updateData.parentId = targetParentId;
      }

      // Explicit level validation guardrail
      if (level === 'sub') {
        if (!targetParentId || targetParentId <= 0) {
          return sendError(res, 'Parent Primary Category is required for a sub-category', 400);
        }
        updateData.parentId = targetParentId;
      } else if (level === 'primary') {
        targetParentId = null;
        updateData.parentId = null;
      }

      // Handle name update
      let targetName = existing.name;
      if (name !== undefined) {
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName) {
          return sendError(res, 'Category name is required', 400);
        }
        targetName = cleanName;
        updateData.name = cleanName;
      }

      // Check scoped uniqueness if name or parent changed
      if (targetName !== existing.name || targetParentId !== existing.parentId) {
        const duplicate = await prisma.expenseCategory.findFirst({
          where: {
            id: { not: id },
            name: targetName,
            parentId: targetParentId,
            isActive: true,
          },
        });

        if (duplicate) {
          return sendError(
            res,
            targetParentId
              ? `Sub-category '${targetName}' already exists under this primary category`
              : `Primary category '${targetName}' already exists`,
            409
          );
        }
      }

      // Handle description update (strictly optional)
      if (description !== undefined) {
        updateData.description = typeof description === 'string' && description.trim() ? description.trim() : null;
      }

      const updated = await prisma.expenseCategory.update({
        where: { id },
        data: updateData,
        include: {
          parent: {
            select: { id: true, name: true },
          },
          subCategories: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
          },
          _count: {
            select: { expenses: true, subExpenses: true },
          },
        },
      });

      return sendSuccess(res, updated);
    } catch (err) {
      sendErrorFrom(res, err, 'Failed to update expense category');
    }
  }

  /**
   * GET /api/expenses
   * List expenses with optional date range, primary categoryId, subCategoryId, and search filtering.
   */
  async getExpenses(req: Request, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, categoryId, subCategoryId, search } = req.query;

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

      // Primary Category filter
      if (categoryId && categoryId !== 'all') {
        const catId = parseInt(String(categoryId), 10);
        if (!isNaN(catId) && catId > 0) {
          where.categoryId = catId;
        }
      }

      // Sub-Category filter
      if (subCategoryId && subCategoryId !== 'all') {
        const subId = parseInt(String(subCategoryId), 10);
        if (!isNaN(subId) && subId > 0) {
          where.subCategoryId = subId;
        }
      }

      // Search filter across code, description, primary category name, or sub-category name
      if (typeof search === 'string' && search.trim()) {
        const term = search.trim();
        where.OR = [
          { code: { contains: term } },
          { description: { contains: term } },
          { category: { name: { contains: term } } },
          { subCategory: { name: { contains: term } } },
        ];
      }

      const expenses = await prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        include: {
          category: {
            select: { id: true, name: true },
          },
          subCategory: {
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
   * Create a new expense record with auto-generated sequential code,
   * validated primary/sub-category hierarchy, and optional description.
   */
  async createExpense(req: Request, res: Response, _next: NextFunction) {
    try {
      const { code, date, categoryId, subCategoryId, description, amount } = req.body;

      const catId = parseInt(String(categoryId), 10);
      if (!catId || isNaN(catId) || catId <= 0) {
        return sendError(res, 'Valid primary expense category is required', 400);
      }

      const cleanDescription = typeof description === 'string' ? description.trim() : '';

      const numAmount = parseFloat(String(amount));
      if (isNaN(numAmount) || numAmount <= 0) {
        return sendError(res, 'Expense amount must be a positive number', 400);
      }

      // Verify primary category existence
      const category = await prisma.expenseCategory.findUnique({
        where: { id: catId },
      });
      if (!category) {
        return sendError(res, 'Selected primary expense category not found', 404);
      }

      // Validate sub-category if provided
      let validSubCategoryId: number | null = null;
      if (
        subCategoryId !== undefined &&
        subCategoryId !== null &&
        subCategoryId !== '' &&
        subCategoryId !== 'none' &&
        subCategoryId !== 0
      ) {
        const subId = parseInt(String(subCategoryId), 10);
        if (isNaN(subId) || subId <= 0) {
          return sendError(res, 'Valid sub-category ID is required', 400);
        }
        const subCategory = await prisma.expenseCategory.findUnique({
          where: { id: subId },
        });
        if (!subCategory) {
          return sendError(res, 'Selected sub-category not found', 404);
        }
        if (subCategory.parentId !== catId) {
          return sendError(res, 'The selected sub-category does not belong to the selected primary category', 400);
        }
        validSubCategoryId = subId;
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
          subCategoryId: validSubCategoryId,
          description: cleanDescription,
          amount: Math.round(numAmount * 100) / 100,
          createdById,
        },
        include: {
          category: {
            select: { id: true, name: true },
          },
          subCategory: {
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
   * PUT / PATCH /api/expenses/:id
   * Update an existing expense record with optional description and validated sub-category.
   */
  async updateExpense(req: Request, res: Response, _next: NextFunction) {
    try {
      const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const id = parseInt(String(rawId), 10);
      if (!id || isNaN(id) || id <= 0) {
        return sendError(res, 'Valid expense ID is required', 400);
      }

      const { code, date, categoryId, subCategoryId, description, amount } = req.body;

      const existing = await prisma.expense.findUnique({
        where: { id },
      });
      if (!existing) {
        return sendError(res, 'Expense record not found', 404);
      }

      const updateData: any = {};
      let targetCategoryId = existing.categoryId;

      if (categoryId !== undefined) {
        const catId = parseInt(String(categoryId), 10);
        if (isNaN(catId) || catId <= 0) {
          return sendError(res, 'Valid expense category ID is required', 400);
        }
        const category = await prisma.expenseCategory.findUnique({ where: { id: catId } });
        if (!category) {
          return sendError(res, 'Expense category not found', 404);
        }
        targetCategoryId = catId;
        updateData.categoryId = catId;
      }

      // Handle sub-category assignment
      if (subCategoryId !== undefined) {
        if (
          subCategoryId === null ||
          subCategoryId === '' ||
          subCategoryId === 'none' ||
          subCategoryId === 0
        ) {
          updateData.subCategoryId = null;
        } else {
          const subId = parseInt(String(subCategoryId), 10);
          if (isNaN(subId) || subId <= 0) {
            return sendError(res, 'Valid sub-category ID is required', 400);
          }
          const subCategory = await prisma.expenseCategory.findUnique({
            where: { id: subId },
          });
          if (!subCategory) {
            return sendError(res, 'Selected sub-category not found', 404);
          }
          if (subCategory.parentId !== targetCategoryId) {
            return sendError(res, 'The selected sub-category does not belong to the selected primary category', 400);
          }
          updateData.subCategoryId = subId;
        }
      } else if (categoryId !== undefined && existing.subCategoryId) {
        // If category changed without passing subCategoryId, ensure old subCategory still matches
        const existingSub = await prisma.expenseCategory.findUnique({
          where: { id: existing.subCategoryId },
        });
        if (!existingSub || existingSub.parentId !== targetCategoryId) {
          updateData.subCategoryId = null;
        }
      }

      // Description is strictly optional
      if (description !== undefined) {
        updateData.description = typeof description === 'string' ? description.trim() : '';
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
          subCategory: {
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

