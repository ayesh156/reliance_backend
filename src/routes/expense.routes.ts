import { Router } from 'express';
import expenseController from '../controllers/expense.controller.ts';
import { verifyToken, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// ── Expense Categories ──
// GET /api/expenses/categories — List all active categories (all authenticated users)
router.get('/categories', verifyToken, expenseController.getCategories.bind(expenseController));

// POST /api/expenses/categories — Create new expense category (Admin & Staff)
router.post('/categories', verifyToken, requireRole('ADMIN', 'STAFF'), expenseController.createCategory.bind(expenseController));

// ── Expense Transactions ──
// GET /api/expenses — List & filter expenses with summary KPI analytics
router.get('/', verifyToken, expenseController.getExpenses.bind(expenseController));

// POST /api/expenses — Record new expense with sequential EXP-XXXX auto-coding (Admin & Staff)
router.post('/', verifyToken, requireRole('ADMIN', 'STAFF'), expenseController.createExpense.bind(expenseController));

// PUT /api/expenses/:id — Update existing expense (Admin & Staff)
router.put('/:id', verifyToken, requireRole('ADMIN', 'STAFF'), expenseController.updateExpense.bind(expenseController));

// DELETE /api/expenses/:id — Delete expense entry (Admin only)
router.delete('/:id', verifyToken, requireRole('ADMIN'), expenseController.deleteExpense.bind(expenseController));

export default router;

