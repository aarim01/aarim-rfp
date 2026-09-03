import { Page } from 'playwright';
import { Logger } from '@nestjs/common';
import { BaseScraper, TenderData, ScrapingResult } from '../base/base-scraper.interface';

interface CanadaBuysRow {
  // BOM-prefixed first column
  [key: string]: string;
}

export class CanadaBuysScraper extends BaseScraper {
  private readonly logger = new Logger(CanadaBuysScraper.name);

  // Official CanadaBuys open data CSV — all currently OPEN tender notices
  private readonly OPEN_TENDERS_CSV =
    'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';

  constructor() {
    super({
      name: 'CanadaBuys',
      baseUrl: 'https://canadabuys.canada.ca',
      region: 'canada',
      rateLimitMs: 1000,
      maxRetries: 3,
      timeoutMs: 30000,
    });
  }

  async scrape(_page: Page): Promise<ScrapingResult> {
    return this.fetchFromOfficialCsv();
  }

  private async fetchFromOfficialCsv(): Promise<ScrapingResult> {
    const result: ScrapingResult = {
      success: false,
      tenders: [],
      errors: [],
      metadata: { totalScanned: 0, scrapedAt: new Date() },
    };

    try {
      const response = await fetch(this.OPEN_TENDERS_CSV, {
        headers: {
          Accept: 'text/csv,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        result.errors.push(`CanadaBuys CSV API returned ${response.status}`);
        return result;
      }

      const csvText = await response.text();
      const rows = this.parseCsv(csvText);
      result.metadata.totalScanned = rows.length;
      this.logger.log(`CanadaBuys CSV: ${rows.length} total rows parsed`);

      let skipped = 0;
      const valid: CanadaBuysRow[] = [];
      for (const row of rows) {
        const validation = this.validateRow(row);
        if (validation.valid) {
          valid.push(row);
        } else {
          skipped++;
          this.logger.debug(`Skipped row: ${validation.reason}`);
        }
      }
      this.logger.log(`CanadaBuys: ${valid.length} valid rows, ${skipped} skipped`);

      // Sort by publication date descending and take the 50 most recent
      const sorted = valid
        .sort((a, b) => {
          const da = new Date(this.getField(a, 'publicationDate-datePublication') || 0).getTime();
          const db = new Date(this.getField(b, 'publicationDate-datePublication') || 0).getTime();
          return db - da;
        })
        .slice(0, 50);

      for (const row of sorted) {
        const tender = this.mapRow(row);
        if (tender) {
          result.tenders.push(tender);
        }
      }

      result.success = result.tenders.length > 0;
      this.logger.log(`CanadaBuys: ${result.tenders.length} tenders mapped for insertion`);
    } catch (error) {
      result.errors.push(`CanadaBuys CSV fetch failed: ${error.message}`);
    }

    return result;
  }

  // Reject non-tender rows: must have title, solicitation number, organization, and valid URL
  private validateRow(row: CanadaBuysRow): { valid: boolean; reason?: string } {
    const title = this.getField(row, 'title-titre-eng');
    if (!title || title.length < 5) return { valid: false, reason: `Empty or too-short title: "${title}"` };

    // Reject HTML entity garbage (corrupted multi-line parse artifact)
    if (/&[a-z]+;|&#\d+;/.test(title)) return { valid: false, reason: `HTML entities in title (parse error): "${title.slice(0,60)}"` };

    // Reject disclaimer text fragments that appear in descriptions
    const disclaimerPhrases = [
      'by submitting a response', 'en répondant à cette', 'after closing', 'après la clôture',
      'reserve des appels', 'réserver des appels',
    ];
    const titleLower = title.toLowerCase();
    for (const phrase of disclaimerPhrases) {
      if (titleLower.startsWith(phrase)) return { valid: false, reason: `Title is a disclaimer fragment: "${title.slice(0,60)}"` };
    }

    const solNum = this.getField(row, 'solicitationNumber-numeroSollicitation');
    if (!solNum) return { valid: false, reason: `Missing solicitation number for: "${title}"` };

    const org = this.getField(row, 'contractingEntityName-nomEntitContractante-eng');
    if (!org) return { valid: false, reason: `Missing organization for: "${title}"` };

    const pubStr = this.getField(row, 'publicationDate-datePublication');
    if (!pubStr) return { valid: false, reason: `Missing publication date for: "${title}"` };

    return { valid: true };
  }

  // Strip BOM and quotes, find field by partial key match
  private getField(row: CanadaBuysRow, partialKey: string): string {
    for (const key of Object.keys(row)) {
      const clean = key.replace(/^﻿|^"|"$/g, '');
      if (clean === partialKey || clean.includes(partialKey)) {
        return (row[key] || '').trim();
      }
    }
    return '';
  }

  private mapRow(row: CanadaBuysRow): TenderData | null {
    const title = this.getField(row, 'title-titre-eng');
    if (!title || title.length < 5) return null;

    const org = this.getField(row, 'contractingEntityName-nomEntitContractante-eng');
    if (!org) return null;

    const closingStr = this.getField(row, 'tenderClosingDate-appelOffresDateCloture');
    const pubStr = this.getField(row, 'publicationDate-datePublication');
    const solNum = this.getField(row, 'solicitationNumber-numeroSollicitation');
    const refNum = this.getField(row, 'referenceNumber-numeroReference');
    const province = this.getField(row, 'contractingEntityAddressProvince-entiteContractanteAdresseProvince-eng');

    const category =
      this.getField(row, 'gsinDescription-nibsDescription-eng') ||
      this.getField(row, 'unspscDescription-eng') ||
      this.getField(row, 'procurementCategory-categorieApprovisionnement') ||
      this.getField(row, 'noticeType-avisType-eng') ||
      'General Procurement';

    // Canonical CanadaBuys URL uses the reference number
    const canonicalUrl = refNum
      ? `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${refNum}`
      : solNum
        ? `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${solNum}`
        : null;

    // CSV also provides a direct notice URL (may be MERX or other platform)
    const csvUrl = this.getField(row, 'noticeURL-URLavis-eng');

    // Use canonical CanadaBuys URL as primary source; CSV URL as reference
    const sourceUrl = canonicalUrl || csvUrl || this.config.baseUrl;

    // Reject if we can't build a valid source URL
    if (!sourceUrl.startsWith('http')) return null;

    const description = this.cleanText(
      this.getField(row, 'tenderDescription-descriptionAppelOffres-eng'),
    );
    const procMethod = this.getField(row, 'procurementMethod-methodeApprovisionnement-eng');
    const deadline = closingStr ? new Date(closingStr) : null;
    const publishedDate = pubStr ? new Date(pubStr) : null;

    // Require a valid publication date
    if (!publishedDate || isNaN(publishedDate.getTime())) return null;

    return {
      title: this.cleanText(title),
      description,
      organization: this.cleanText(org),
      country: 'Canada',
      province_region: province || undefined,
      category: this.cleanText(category).slice(0, 100),
      deadline: deadline && !isNaN(deadline.getTime()) ? deadline : null,
      published_date: publishedDate,
      tender_number: solNum || refNum,
      source_url: sourceUrl.slice(0, 500),
      procurement_type: (procMethod || 'Open Bidding').slice(0, 100),
      status: deadline && deadline < new Date() ? 'closed' : 'open',
    };
  }

  // RFC 4180-compliant CSV parser — handles multi-line quoted fields
  private parseCsv(text: string): CanadaBuysRow[] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const records = this.splitCsvRecords(normalized);
    if (records.length < 2) return [];

    const headers = records[0].map(h => h.replace(/^﻿/, '').trim());
    const rows: CanadaBuysRow[] = [];

    for (let i = 1; i < records.length; i++) {
      const values = records[i];
      if (values.length < 3) continue;
      const row: CanadaBuysRow = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').trim();
      });
      rows.push(row);
    }

    return rows;
  }

  // Parse entire CSV text into records (arrays of fields), handling newlines inside quotes
  private splitCsvRecords(text: string): string[][] {
    const records: string[][] = [];
    let i = 0;

    while (i < text.length) {
      const record: string[] = [];

      while (i < text.length) {
        let field = '';

        if (text[i] === '"') {
          // Quoted field
          i++; // skip opening quote
          while (i < text.length) {
            if (text[i] === '"') {
              if (text[i + 1] === '"') {
                field += '"';
                i += 2;
              } else {
                i++; // skip closing quote
                break;
              }
            } else {
              field += text[i++];
            }
          }
        } else {
          // Unquoted field — read until comma or newline
          while (i < text.length && text[i] !== ',' && text[i] !== '\n') {
            field += text[i++];
          }
        }

        record.push(field);

        if (i < text.length && text[i] === ',') {
          i++; // skip comma, continue to next field
        } else {
          // newline or end of text — end of record
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
