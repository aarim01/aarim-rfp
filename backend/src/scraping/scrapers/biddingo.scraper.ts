import { Page } from 'playwright';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';
import { Logger } from '@nestjs/common';

interface BiddingoTender {
  buyerSysId: number;
  buyerOrgId: number;
  biddingoTenderId: number;
  tenderNumber: string;
  tenderName: string;
  tenderClosingDate: string | null;
  publishedDate: string | null;
  bidStatus: string;
  daysleft: number | null;
  country: string | null;
  province: string | null;
  city: string | null;
  regionName: string | null;
  procurementType: string | null;
  valueRange: string | null;
}

export class BiddingoScraper extends BaseScraper {
  private readonly logger = new Logger(BiddingoScraper.name);

  private readonly API_URL =
    'https://api.biddingo.com/restapi/v2/noauthorize/bids?limit=50&statuses=1&sort=postedDate%3Adesc';

  constructor() {
    super({
      name: 'Biddingo',
      baseUrl: 'https://www.biddingo.com',
      region: 'canada',
      rateLimitMs: 2000,
      maxRetries: 1,
      timeoutMs: 90000,
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
      // Load the Biddingo search page — this establishes the session/cookies
      // that the Angular app needs to call the noauthorize API.
      // Use 'load' (not 'networkidle') to avoid timing out on large JS bundles.
      await page.goto('https://www.biddingo.com/search', {
        waitUntil: 'load',
        timeout: this.config.timeoutMs,
      });

      // Allow Angular to bootstrap and set session state
      await page.waitForTimeout(3000);

      // Call the public tender listing API from within the browser context.
      // The /v2/noauthorize/bids endpoint is accessible to the browser session
      // after the Biddingo Angular app loads (sets cookies/headers).
      const apiResponse = await page.evaluate(async (apiUrl: string) => {
        const res = await fetch(apiUrl, {
          headers: {
            Accept: 'application/json, text/plain, */*',
            Origin: 'https://www.biddingo.com',
            Referer: 'https://www.biddingo.com/search',
          },
        });
        const text = await res.text();
        return { status: res.status, body: text };
      }, this.API_URL);

      if (apiResponse.status !== 200) {
        throw new Error(`Biddingo API returned HTTP ${apiResponse.status}`);
      }

      let data: { bidInfoList?: BiddingoTender[] };
      try {
        data = JSON.parse(apiResponse.body);
      } catch {
        if (apiResponse.body.trim().startsWith('<')) {
          throw new Error(
            'Biddingo API returned HTML instead of JSON. ' +
            'The session may not have been established correctly.',
          );
        }
        throw new Error('Failed to parse Biddingo API response as JSON');
      }

      const bids = data.bidInfoList ?? [];
      result.metadata.totalScanned = bids.length;

      this.logger.log(`Biddingo API returned ${bids.length} bids`);

      for (const bid of bids) {
        const tender = this.mapBid(bid);
        if (tender) result.tenders.push(tender);
      }

      result.success = result.tenders.length > 0;
    } catch (error) {
      this.logger.error(`Biddingo scraping failed: ${error.message}`);
      result.errors.push(error.message);
      result.success = false;
    }

    return result;
  }

  private mapBid(bid: BiddingoTender): TenderData | null {
    const title = (bid.tenderName || '').trim();
    if (!title || title.length < 3) return null;

    // Parse published date: "06/29/2026" → Date
    const publishedDate = this.parseDate(bid.publishedDate);

    // Closing date: tenderClosingDate when available, otherwise approximate from daysleft
    let deadline: Date | null = null;
    if (bid.tenderClosingDate) {
      deadline = this.parseDate(bid.tenderClosingDate);
    } else if (bid.daysleft != null && bid.daysleft >= 0) {
      deadline = new Date();
      deadline.setDate(deadline.getDate() + bid.daysleft);
    }

    // Biddingo does not expose publicly accessible direct links to individual tender pages.
    // All direct formats (/sysId/orgId/tenderId and /redirectlink/S/...) either show a
    // PHP "WARNING!" error or load a blank Angular shell.
    // The only public URL that opens the specific tender is the keyword search page.
    // Verified in Playwright: https://www.biddingo.com/search?k={title} shows the tender
    // without requiring authentication.
    const cleanTitle = this.cleanText(title);
    const sourceUrl = `${this.config.baseUrl}/search?k=${encodeURIComponent(cleanTitle)}`;

    const country = bid.country || 'Canada';

    // Note: buyerName is redacted ("OXOXOXOX") for non-subscribers.
    // Use location as organization proxy.
    const organization =
      bid.city && bid.province
        ? `Government Buyer — ${bid.city}, ${bid.province}`
        : 'Government Buyer (Biddingo Network)';

    const category = (bid.regionName || bid.procurementType || 'Government Procurement').slice(0, 100);

    return {
      title: this.cleanText(title),
      description: '',
      organization: organization.slice(0, 255),
      country,
      category,
      deadline,
      published_date: publishedDate,
      tender_number: bid.biddingoTenderId.toString(),
      source_url: sourceUrl.slice(0, 500),
      procurement_type: (bid.procurementType || 'Open Bidding').slice(0, 100),
      status: deadline && deadline < new Date() ? 'closed' : 'open',
    };
  }
}
