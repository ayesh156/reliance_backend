/**
 * Image URL Normalizer Engine (Backend)
 * Normalizes Google Drive links into high-res zero-CORS thumbnail CDN URLs.
 */

export function extractGoogleDriveFileId(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  const fileDMatch = trimmed.match(/(?:drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)\/(?:file\/d|d)\/([a-zA-Z0-9_-]+)/i);
  if (fileDMatch && fileDMatch[1]) {
    return fileDMatch[1];
  }

  if (
    trimmed.includes('drive.google.com') ||
    trimmed.includes('docs.google.com') ||
    trimmed.includes('drive.usercontent.google.com') ||
    trimmed.includes('googleusercontent.com')
  ) {
    const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
    if (idParamMatch && idParamMatch[1]) {
      return idParamMatch[1];
    }
  }

  return null;
}

export function normalizeImageUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const fileId = extractGoogleDriveFileId(trimmed);
  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  }

  return trimmed;
}
