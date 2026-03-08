/**
 * MetaNexus Crawler
 *
 * Given a list of URLs, auto-detects the protocol, fetches and normalizes
 * each agent into a UniversalAgentCard.
 *
 * Usage:
 *   const crawler = new Crawler();
 *   const results = await crawler.crawl(['https://agent.example.com', ...]);
 */

import type {
  ProtocolAdapter,
  UniversalAgentCard,
  DetectionResult,
} from '../core/types.js';
import { ALL_ADAPTERS } from '../adapters/index.js';

// ---- Types -------------------------------------------------------------------

export type CrawlStatus = 'success' | 'no_protocol' | 'fetch_error' | 'normalize_error';

export interface CrawlResult {
  url: string;
  status: CrawlStatus;
  protocol?: string;
  card?: UniversalAgentCard;
  error?: string;
  durationMs: number;
}

export interface CrawlerOptions {
  /** Adapters to use, in priority order. Defaults to ALL_ADAPTERS. */
  adapters?: ProtocolAdapter[];
  /** Minimum confidence to accept a detection. Default: 0.5 */
  minConfidence?: number;
  /** Max concurrent requests. Default: 5 */
  concurrency?: number;
}

// ---- Crawler -----------------------------------------------------------------

export class Crawler {
  private readonly adapters: ProtocolAdapter[];
  private readonly minConfidence: number;
  private readonly concurrency: number;

  constructor(options: CrawlerOptions = {}) {
    this.adapters = options.adapters ?? ALL_ADAPTERS;
    this.minConfidence = options.minConfidence ?? 0.5;
    this.concurrency = options.concurrency ?? 5;
  }

  /**
   * Crawl a single URL.
   * Returns a CrawlResult regardless of success or failure.
   */
  async crawlOne(url: string): Promise<CrawlResult> {
    const start = Date.now();

    // 1. Detect protocol
    let bestDetection: DetectionResult & { adapter: ProtocolAdapter } | null = null;
    for (const adapter of this.adapters) {
      const detection = await adapter.detect(url);
      if (detection.detected && detection.confidence >= this.minConfidence) {
        if (!bestDetection || detection.confidence > bestDetection.confidence) {
          bestDetection = { ...detection, adapter };
        }
      }
    }

    if (!bestDetection) {
      return { url, status: 'no_protocol', durationMs: Date.now() - start };
    }

    const adapter = bestDetection.adapter;

    // 2. Fetch
    let raw;
    try {
      raw = await adapter.fetch(url);
    } catch (err) {
      return {
        url,
        status: 'fetch_error',
        protocol: adapter.protocol,
        error: String(err),
        durationMs: Date.now() - start,
      };
    }

    // 3. Normalize
    let card: UniversalAgentCard;
    try {
      card = adapter.normalize(raw);
    } catch (err) {
      return {
        url,
        status: 'normalize_error',
        protocol: adapter.protocol,
        error: String(err),
        durationMs: Date.now() - start,
      };
    }

    return {
      url,
      status: 'success',
      protocol: adapter.protocol,
      card,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Crawl multiple URLs with bounded concurrency.
   */
  async crawl(urls: string[]): Promise<CrawlResult[]> {
    const results: CrawlResult[] = [];
    const queue = [...urls];

    async function worker(self: Crawler) {
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) break;
        results.push(await self.crawlOne(url));
      }
    }

    const workers = Array.from(
      { length: Math.min(this.concurrency, urls.length) },
      () => worker(this)
    );
    await Promise.all(workers);

    return results;
  }

  /**
   * Crawl and return only successfully normalized cards.
   */
  async crawlCards(urls: string[]): Promise<UniversalAgentCard[]> {
    const results = await this.crawl(urls);
    return results
      .filter(r => r.status === 'success' && r.card)
      .map(r => r.card!);
  }
}
