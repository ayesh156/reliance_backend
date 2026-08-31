import { Request, Response } from 'express';
import settingsService from '../services/settings.service';
import { sendErrorFrom } from '../utils/response';

export class SettingsController {
  /** GET /api/settings — Fetch all storefront settings */
  async getAll(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await settingsService.getSettings();
      res.json(settings);
    } catch (error) {
      console.error('[SettingsController] Error fetching settings:', error);
      sendErrorFrom(res, error, 'Failed to fetch settings');
    }
  }

  /** PUT /api/settings — Upsert an array of { key, value } pairs */
  async update(req: Request, res: Response): Promise<void> {
    try {
      const result = await settingsService.updateSettings(req.body);
      res.json(result);
    } catch (error) {
      console.error('[SettingsController] Error saving settings:', error);
      sendErrorFrom(res, error, 'Failed to save settings');
    }
  }
}

export default new SettingsController();