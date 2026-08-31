import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import productController from '../controllers/product.controller';
import { ensureUploadDir } from '../utils/fileHandler';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_PRODUCT_IMAGES } from '../config/constants';
import { verifyToken, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ensureUploadDir('products')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } });

// ── Public Routes (Storefront & POS Reads) ──
router.get('/', productController.getAll);
router.get('/:id', productController.getById);

// ── Protected Routes (Admin & Staff Management) ──
router.post(
  '/',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  upload.array('imageFiles', MAX_PRODUCT_IMAGES),
  productController.create
);

router.put(
  '/:id',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  upload.array('imageFiles', MAX_PRODUCT_IMAGES),
  productController.update
);

router.delete(
  '/:productId/images/:imageId',
  verifyToken,
  requireRole('ADMIN', 'STAFF'),
  productController.deleteImage
);

router.delete(
  '/:id',
  verifyToken,
  requireRole('ADMIN'),
  productController.remove
);

export default router;