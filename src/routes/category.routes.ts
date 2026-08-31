import { Router } from 'express';
import categoryController from '../controllers/category.controller';

const router = Router();

router.get('/', categoryController.getAll);

export default router;