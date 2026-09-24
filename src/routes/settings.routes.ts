import { Router } from 'express';
import settingsController from '../controllers/settings.controller.ts';

const router = Router();

router.get('/', settingsController.getAll);
router.put('/', settingsController.update);

export default router;