import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

/**
 * Deletes a local file from the server given a relative path starting with /uploads/.
 * If the path starts with 'http' (external URL), it is skipped.
 */
export function deleteLocalFile(relativePath: string | null | undefined): void {
  if (!relativePath || relativePath.startsWith('http')) return;
  const fullPath = path.join(PUBLIC_DIR, relativePath);
  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log(`[FileHandler] Deleted: ${fullPath}`);
    } catch (err) {
      console.error(`[FileHandler] Failed to delete ${fullPath}:`, err);
    }
  }
}

/**
 * Deletes an old image from the server if it exists and is a local file (starts with /uploads/).
 * Alias for deleteLocalFile.
 */
export function deleteOldImage(fileUrl: string | null | undefined): void {
  deleteLocalFile(fileUrl);
}

/**
 * Generates a unique filename and returns the relative path.
 */
export function generateImagePath(folder: string, ext: string): string {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  return `/uploads/${folder}/${filename}`;
}

/**
 * Ensures an upload directory exists.
 */
export function ensureUploadDir(folder: string): string {
  const dir = path.join(PUBLIC_DIR, 'uploads', folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}