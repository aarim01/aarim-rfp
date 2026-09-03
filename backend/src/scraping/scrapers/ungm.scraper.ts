import { Page } from 'playwright';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';

interface UngmNoticeRaw {
  noticeId: string;
  title: string;
  deadlineText: string;
  publishedText: string;
  agency: string;
  noticeType: string;
  reference: string;
  country: string;
  url: string;
}

export class UngmScraper extends BaseScraper {
  constructor() {
    super({
      name: 'UNGM',
      baseUrl: 'https://www.ungm.org',
      region: 'worldwide',
      rateLimitMs: 1500,
      maxRetries: 3,
      timeoutMs: 45000,
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
      // Navigate to the public procurement notice search page
      await page.goto('https://www.ungm.org/Public/Notice', {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });

      // UNGM fires an AJAX search automatically on page load.
      // Wait for the first notice row to appear in the DOM.
      await page.waitForSelector('.tableRow.dataRow.notice-table', { timeout: 20000 });
      await page.waitForTimeout(2000);

      // Extract all visible notice rows
      const notices: UngmNoticeRaw[] = await page.evaluate(() => {
        const rows = document.querySelectorAll('.tableRow.dataRow.notice-table');
        return Array.from(rows).map(row => {
          const noticeId = row.getAttribute('data-noticeid') || '';

          const titleEl = row.querySelector('.tableCell.resultTitle .ungm-title');
          const title = (titleEl as HTMLElement)?.innerText?.trim() || '';

          const deadlineEl = row.querySelector('.tableCell.deadline');
          const deadlineText = (deadlineEl as HTMLElement)?.innerText?.split('\n')[0].trim() || '';

          const cells = Array.from(row.querySelectorAll('[role="cell"]'));
          // cell[0] = options/buttons, [1] = title, [2] = deadline, [3] = pubDate,
          // [4] = agency, [5] = type, [6] = reference, [7] = country
          const publishedText = (cells[3] as HTMLElement)?.innerText?.trim() || '';
          const agencyEl = row.querySelector('.tableCell.resultAgency');
          const agency = (agencyEl as HTMLElement)?.innerText?.trim() || 'United Nations';
          const noticeType = (cells[5] as HTMLElement)?.innerText?.trim() || '';
          const refEl = row.querySelector('.tableCell.resultInfo1:not(.deadline)');
          const reference = (refEl as HTMLElement)?.innerText?.trim() || '';
          const country = (cells[cells.length - 1] as HTMLElement)?.innerText?.trim() || '';

          const linkEl = row.querySelector('a[href*="/Public/Notice/"]');
          const href = (linkEl as HTMLAnchorElement)?.getAttribute('href') || '';
          const url = href.startsWith('http') ? href : `https://www.ungm.org${href}`;

          return { noticeId, title, deadlineText, publishedText, agency, noticeType, reference, country, url };
        });
      });

      result.metadata.totalScanned = notices.length;

      for (const notice of notices) {
        if (!notice.title) continue;
        const tender = this.mapNotice(notice);
        if (tender) result.tenders.push(tender);
      }

      result.success = result.tenders.length > 0;
    } catch (error) {
      result.errors.push(`UNGM scraping failed: ${error.message}`);
      result.success = false;
    }

    return result;
  }

  private mapNotice(notice: UngmNoticeRaw): TenderData | null {
    const title = this.cleanText(notice.title);
    if (!title) return null;

    // Parse deadline: "29-Jun-2026 13:00 (GMT -4.00)" → extract date part
    const deadlineParts = notice.deadlineText.replace(/\(GMT[^)]*\)/i, '').trim();
    const deadline = this.parseDate(deadlineParts);

    const publishedDate = this.parseDate(notice.publishedText);

    const sourceUrl = notice.url || `${this.config.baseUrl}/Public/Notice`;

    return {
      title,
      description: '',
      organization: this.cleanText(notice.agency) || 'United Nations',
      country: this.cleanText(notice.country) || 'International',
      category: (this.cleanText(notice.noticeType) || 'General Procurement').slice(0, 100),
      deadline,
      published_date: publishedDate,
      tender_number: this.cleanText(notice.reference),
      source_url: sourceUrl.slice(0, 500),
      procurement_type: (this.cleanText(notice.noticeType) || 'Open').slice(0, 100),
      status: deadline && deadline < new Date() ? 'closed' : 'open',
    };
  }
}
