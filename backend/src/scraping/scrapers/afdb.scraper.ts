import { Page } from 'playwright';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';
import { Logger } from '@nestjs/common';

export class AfdbScraper extends BaseScraper {
  private readonly logger = new Logger(AfdbScraper.name);

  constructor() {
    super({
      name: 'AfDB',
      baseUrl: 'https://www.afdb.org',
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
      await page.goto('https://www.afdb.org/en/projects-operations/procurement', {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });

      const title = await page.title();

      if (
        title.toLowerCase().includes('attention required') ||
        title.toLowerCase().includes('cloudflare') ||
        title.toLowerCase().includes('just a moment')
      ) {
        throw new Error(
          'Blocked by Cloudflare Bot Management. AfDB requires a verified browser session. ' +
            'Automated scraping of afdb.org is not possible without residential proxies.',
        );
      }

      // Try to find procurement rows if not blocked
      await page.waitForSelector('.project-item, .procurement-item, article', { timeout: 10000 }).catch(() => {});
      const rows = await page.$$('.project-item, .procurement-item, article');

      if (rows.length === 0) {
        throw new Error('AfDB page loaded but no procurement rows found — structure may have changed or access is restricted.');
      }

      result.metadata.totalScanned = rows.length;

      for (const row of rows) {
        try {
          const titleEl = await row.$('h3 a, .title a, a[href*="project"]');
          if (!titleEl) continue;
          const tenderTitle = await titleEl.innerText();
          const href = await titleEl.getAttribute('href');
          const sourceUrl = href ? (href.startsWith('http') ? href : `${this.config.baseUrl}${href}`) : this.config.baseUrl;

          result.tenders.push({
            title: this.cleanText(tenderTitle),
            description: '',
            organization: 'African Development Bank',
            country: 'Africa',
            category: 'General Procurement',
            deadline: null,
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
      this.logger.error(`AfDB scraping failed: ${error.message}`);
      result.errors.push(error.message);
      result.success = false;
    }

    return result;
  }
}
