import { Page } from 'playwright';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';
import { Logger } from '@nestjs/common';

export class MerxScraper extends BaseScraper {
  private readonly logger = new Logger(MerxScraper.name);

  constructor() {
    super({
      name: 'MERX',
      baseUrl: 'https://www.merx.com',
      region: 'canada',
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
      const response = await page.goto('https://www.merx.com/english/OpportunityList.aspx', {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });

      const status = response?.status() ?? 0;
      if (status === 403 || status === 401) {
        throw new Error(
          `MERX returned HTTP ${status}. MERX requires a registered account to access tender listings. ` +
            'A free or paid registration at merx.com is required to view procurement opportunities.',
        );
      }

      await page.waitForTimeout(3000);

      // MERX requires login to view most content. Try to detect login wall.
      const loginIndicator = await page.$('input[name*="UserName"], input[name*="Password"], .login, #login');
      if (loginIndicator) {
        throw new Error(
          'MERX requires authentication. The opportunities page redirected to a login page. ' +
            'Register at merx.com to access Canadian government tender listings.',
        );
      }

      // Try to find tender rows if page is accessible
      await page.waitForSelector('table tr, .opportunity-list, .tender-row', { timeout: 8000 }).catch(() => {});
      const rows = await page.$$('table tr[class], .opportunity-item, .tender-row');

      if (rows.length === 0) {
        throw new Error('MERX page loaded but no tender listings found. Authentication may be required.');
      }

      result.metadata.totalScanned = rows.length;

      for (const row of rows) {
        try {
          const titleEl = await row.$('td a, .title a, a[href*="Opportunity"]');
          if (!titleEl) continue;
          const title = await titleEl.innerText();
          if (!title?.trim()) continue;

          const href = await titleEl.getAttribute('href');
          const sourceUrl = href ? (href.startsWith('http') ? href : `${this.config.baseUrl}${href}`) : this.config.baseUrl;

          const cells = await row.$$('td');
          const deadlineText = cells.length > 2 ? await cells[2].innerText().catch(() => '') : '';

          result.tenders.push({
            title: this.cleanText(title),
            description: '',
            organization: 'Government of Canada',
            country: 'Canada',
            category: 'General',
            deadline: this.parseDate(deadlineText),
            published_date: new Date(),
            tender_number: '',
            source_url: sourceUrl,
            procurement_type: 'Open Bidding',
            status: 'open',
          });
        } catch (_) {}
      }

      result.success = result.tenders.length > 0;
    } catch (error) {
      this.logger.error(`MERX scraping failed: ${error.message}`);
      result.errors.push(error.message);
      result.success = false;
    }

    return result;
  }
}
