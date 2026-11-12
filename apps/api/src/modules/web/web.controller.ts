import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../shared/config/index.js';
import { MonitoringService } from '../monitoring/monitoring.service.js';
import { serializeBootstrap } from './web-state.js';

const pages = new Set([
  '/',
  '/design-system',
  '/conversations',
  '/reviews',
  '/keywords',
  '/rooms',
  '/guide',
  '/messages',
  '/trends',
  '/campaigns',
  '/responses',
  '/briefing',
  '/bookmarks',
  '/aliases',
  '/operations',
  '/episode',
]);
@Controller()
export class WebController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get(['/', '*'])
  async page(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/conversation') {
      const id = url.searchParams.get('id');
      url.searchParams.delete('id');
      const search = url.searchParams.toString();
      return reply.redirect(
        `${id ? `/conversations/${encodeURIComponent(id)}` : '/conversations'}${search ? `?${search}` : ''}`,
      );
    }
    if (/^\/(photo|download)\//.test(url.pathname) || url.pathname === '/results.json') {
      const asset = await this.monitoring.asset(request.url);
      if (asset.disposition) reply.header('Content-Disposition', asset.disposition);
      return reply.type(asset.contentType).send(asset.bytes);
    }
    const webRoot = path.resolve(config.MENTION_WEB_ROOT);
    if (url.pathname === '/brand.svg' || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
      try {
        const file = path.join(webRoot, 'dist', url.pathname);
        const type = file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.svg')
            ? 'image/svg+xml'
            : file.endsWith('.js')
              ? 'application/javascript'
              : 'application/octet-stream';
        return reply.type(type).send(await readFile(file));
      } catch {
        return reply.code(404).send('Not found');
      }
    }
    if (!pages.has(url.pathname) && !/^\/conversations\/[a-zA-Z0-9_-]+$/.test(url.pathname))
      throw new NotFoundException();
    const entry = await import(
      pathToFileURL(path.join(webRoot, 'dist-server/entry-server.mjs')).href
    );
    const queries = {
      overview: (scope: Parameters<MonitoringService['overview']>[0]) =>
        this.monitoring.overview(scope),
      conversations: (query: Parameters<MonitoringService['conversations']>[0]) =>
        this.monitoring.conversations(query),
      classifications: (query: Parameters<MonitoringService['classifications']>[0]) =>
        this.monitoring.classifications(query),
      detail: (id: string) => this.monitoring.detail(id),
    };
    const workspace = {
      read: (feature: string, search: string) =>
        this.monitoring.workspace(feature, Object.fromEntries(new URLSearchParams(search))),
    };
    // Preserve SSR and existing UI. This migration preview deliberately has no write rights.
    const local =
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) &&
      !['cf-ray', 'x-forwarded-for', 'forwarded', 'x-monitor-public'].some(
        (key) => request.headers[key],
      );
    const page = await entry.render(
      request.url,
      queries,
      config.MENTION_WRITES_ENABLED,
      workspace,
      local,
    );
    const state = serializeBootstrap(page.state);
    const template = await readFile(path.join(webRoot, 'dist/index.html'), 'utf8');
    const html = template
      .replace('<!--app-html-->', () => page.html)
      .replace(
        '<!--app-state-->',
        () => `<script id="mention-state" type="application/json">${state}</script>`,
      );
    return reply.header('Cache-Control', 'private, no-store').type('text/html').send(html);
  }
}
