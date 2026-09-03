import { Page } from 'playwright';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';
import { Logger } from '@nestjs/common';

export class AdBankScraper extends BaseScraper {
  private readonly logger = new Logger(AdBankScraper.name);

  constructor() {
    super({
      name: 'ADB',
      baseUrl: 'https://www.adb.org',
      region: 'worldwide',
      rateLimitMs: 2000,
      maxRetries: 1,
      timeoutMs: 30000,
    });
  }

  async scrape(page: Page): Promise<ScrapingResult> {
    const result: ScrapingResult = {
      success: false,
      tenders: [],
      errors: [],
      metadata: { totalScanned: 0, scrapedAt: new Date() },
    };

    try {
      await page.goto('https://www.adb.org/projects/tenders/all', {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });

      const title = await page.title();

      if (
        title.includes('Attention Required') ||
        title.includes('Cloudflare') ||
        title.includes('Just a moment')
      ) {
        throw new Error(
          'Blocked by Cloudflare Bot Management. ADB requires a verified browser session. ' +
            'Automated scraping of adb.org is not possible without residential proxies or manual CAPTCHA solving.',
        );
      }

      // Try to find tender rows if the page loaded
      await page.waitForSelector('.views-row, .view-content tr', { timeout: 10000 }).catch(() => {});
      const rows = await page.$$('.views-row, .view-content tr');

      if (rows.length === 0) {
        throw new Error('ADB page loaded but no tender rows found — page structure may have changed.');
      }

      result.metadata.totalScanned = rows.length;

      for (const row of rows) {
        try {
          const titleEl = await row.$('.views-field-title a, h3 a, .field-content a');
          if (!titleEl) continue;

          const tenderTitle = await titleEl.innerText();
          const href = await titleEl.getAttribute('href');
          const sourceUrl = href ? (href.startsWith('http') ? href : `${this.config.baseUrl}${href}`) : this.config.baseUrl;

          const deadlineEl = await row.$('.deadline, .closing-date, .views-field-field-deadline');
          const deadlineText = deadlineEl ? await deadlineEl.innerText() : '';

          result.tenders.push({
            title: this.cleanText(tenderTitle),
            description: '',
            organization: 'Asian Development Bank',
            country: 'Asia Pacific',
            category: 'General Procurement',
            deadline: this.parseDate(deadlineText),
            published_date: new Date(),
            tender_number: '',
            source_url: sourceUrl,
            procurement_type: 'Open',
            status: 'open',
          });
        } catch (_) {}
      }

      result.success = result.tenders.length > 0;
    } catch (error) {
      this.logger.error(`ADB scraping failed: ${error.message}`);
      result.errors.push(error.message);
      result.success = false;
    }

    return result;
  }
}
