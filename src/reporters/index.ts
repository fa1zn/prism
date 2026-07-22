/**
 * Reporters: turn the evidence store into human-readable output.
 *
 * The first reporter is a Markdown generator that separates observed findings
 * from hypotheses and links each claim back to its supporting evidence.
 */

export type { ReportMeta } from './markdown.js';
export { renderMarkdownReport, summaryParagraph, writeMarkdownReport } from './markdown.js';
export { renderHtmlReport, writeHtmlReport } from './html.js';
