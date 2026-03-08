/**
 * @metanexus/discovery — Agent crawling, search, and trust scoring
 */

export { Crawler } from './crawler.js';
export type { CrawlResult, CrawlStatus, CrawlerOptions } from './crawler.js';

export { AgentRegistry } from './registry.js';

export { getEmbedding, cardToText, cosine } from './embeddings.js';

export { probeEndpoint, computeTrustScore, probeAndScore } from './trust.js';
export type { ProbeResult, TrustInput, TrustWeights } from './trust.js';
