/**
 * Mneme M2 - Adapters Module
 *
 * Exports all source adapters:
 * - Adapter interface and base class
 * - Slack export adapter
 * - Discord data adapter
 * - PDF document adapter
 * - Markdown adapter
 * - Email adapter (MBOX)
 * - Adapter registry
 */

export * from './adapter-interface.js';
export * from './slack-export-adapter.js';
export * from './discord-data-adapter.js';
export * from './pdf-document-adapter.js';
export * from './markdown-adapter.js';
export * from './email-adapter.js';
export * from './adapter-registry.js';
