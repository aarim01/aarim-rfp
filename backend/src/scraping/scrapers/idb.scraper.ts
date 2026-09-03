import { Page } from 'playwright';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';
import { Logger } from '@nestjs/common';

export class IdbScraper extends BaseScraper {
  private readonly logger = new Logger(IdbScraper.name);

  // IDB Open Data CKAN — procurement bidding notices dataset
  // https://data.iadb.org/dataset/project-procurement-bidding-notices-and-notification-of-contract-awards
  private readonly CSV_URL =
    'https://data.iadb.org/file/download/9cc29cd0-c487-42e9-ad49-9971b4125066';

  constructor() {
    super({
      name: 'IDB',
      baseUrl: 'https://www.iadb.org',
      region: 'worldwide',
      rateLimitMs: 2000,
      maxRetries: 3,
      timeoutMs: 60000,
    });
  }

  async scrape(_page: Page): Promise<ScrapingResult> {
    const result: ScrapingResult = {
      success: false,
      tenders: [],
      errors: [],
      metadata: { totalScanned: 0, scrapedAt: new Date() },
    };

    try {
      const response = await fetch(this.CSV_URL, {
        redirect: 'follow',
        headers: {
          Accept: 'text/csv,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://data.iadb.org/',
        },
      });

      if (!response.ok) {
        result.errors.push(`IDB CSV returned ${response.status}`);
        return result;
      }

      const csvText = await response.text();
      const rows = this.parseCsv(csvText);
      result.metadata.totalScanned = rows.length;

      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 2); // last 24 months

      const filtered = rows
        .filter(r => {
          const pubDate = this.parseDate(r.publicationdate);
          const deadline = this.parseDate(r.deadline);
          // Include if published in last 24 months OR deadline is in the future
          const recentEnough = pubDate && pubDate > cutoff;
          const stillOpen = deadline && deadline > new Date();
          return recentEnough || stillOpen;
        })
        .sort((a, b) => {
          const da = new Date(a.publicationdate || 0).getTime();
          const db = new Date(b.publicationdate || 0).getTime();
          return db - da;
        })
        .slice(0, 50);

      for (const row of filtered) {
        const tender = this.mapRow(row);
        if (tender) result.tenders.push(tender);
      }

      result.success = result.tenders.length > 0;
    } catch (error) {
      result.errors.push(`IDB CSV fetch failed: ${error.message}`);
    }

    return result;
  }

  private mapRow(row: Record<string, string>): TenderData | null {
    const title = (row.noticetitle || '').trim();
    if (!title || title.length < 3) return null;

    const deadline = this.parseDate(row.deadline);
    const publishedDate = this.parseDate(row.publicationdate);

    const projectUrl = row.proyecturl || '';
    const docUrl = row.documenturl || '';
    const sourceUrl = projectUrl || docUrl || `${this.config.baseUrl}/en/projects-operations/procurement`;

    const country = (row.countryname || 'Latin America').trim();
    const category = (row.sector || row.category_nm || 'General Procurement').trim();
    const procType = (row.prcrmnt_mthd_engl_nm || row.type || 'Open Bidding').trim();

    return {
      title: this.cleanText(title),
      description: this.cleanText(row.projectname || ''),
      organization: 'Inter-American Development Bank',
      country,
      category: this.cleanText(category).slice(0, 100),
      deadline,
      published_date: publishedDate,
      tender_number: (row.noticeid || row.process_id || '').trim(),
      source_url: sourceUrl,
      procurement_type: this.cleanText(procType).slice(0, 100),
      status: deadline && deadline < new Date() ? 'closed' : 'open',
    };
  }

  // RFC 4180-compliant CSV parser — handles multi-line quoted fields
  private parseCsv(text: string): Record<string, string>[] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const records = this.splitCsvRecords(normalized);
    if (records.length < 2) return [];

    const headers = records[0].map(h => h.replace(/^﻿/, '').trim().toLowerCase());
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < records.length; i++) {
      const values = records[i];
      if (values.length < 3) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').trim();
      });
      rows.push(row);
    }

    return rows;
  }

  private splitCsvRecords(text: string): string[][] {
    const records: string[][] = [];
    let i = 0;

    while (i < text.length) {
      const record: string[] = [];

      while (i < text.length) {
        let field = '';

        if (text[i] === '"') {
          i++;
          while (i < text.length) {
            if (text[i] === '"') {
              if (text[i + 1] === '"') {
                field += '"';
                i += 2;
              } else {
                i++;
                break;
              }
            } else {
              field += text[i++];
            }
          }
        } else {
          while (i < text.length && text[i] !== ',' && text[i] !== '\n') {
            field += text[i++];
          }
        }

        record.push(field);

        if (i < text.length && text[i] === ',') {
          i++;
        } else {
          if (i < text.length && text[i] === '\n') i++;
          break;
        }
      }

      if (record.length > 0 && !(record.length === 1 && record[0] === '')) {
        records.push(record);
      }
    }

    return records;
  }
}
