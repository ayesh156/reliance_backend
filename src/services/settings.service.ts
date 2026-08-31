import { prisma } from '../lib/prisma';
import { HttpException } from '../middleware/error.middleware';

export class SettingsService {
  /**
   * Fetch all storefront settings as a key/value object.
   */
  async getSettings() {
    const settings = await prisma.storefrontSetting.findMany();
    const obj: Record<string, string> = {};
    for (const s of settings) {
      obj[s.key] = s.value;
    }
    return obj;
  }

  /**
   * Upsert an array of { key, value } pairs and return updated settings.
   */
  async updateSettings(entries: { key: string; value: string }[]) {
    if (!Array.isArray(entries)) {
      throw new HttpException(400, 'Body must be an array of { key, value } objects');
    }

    for (const entry of entries) {
      if (!entry.key || typeof entry.key !== 'string') {
        throw new HttpException(400, 'Each entry must have a valid string "key"');
      }
      await prisma.storefrontSetting.upsert({
        where: { key: entry.key },
        create: { key: entry.key, value: entry.value ?? '' },
        update: { value: entry.value ?? '' },
      });
    }

    return this.getSettings();
  }
}

export default new SettingsService();