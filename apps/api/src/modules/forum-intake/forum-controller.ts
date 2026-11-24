import { PokergosuContractError } from '@app/shared';
import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import type { CollectorPrincipal } from './forum-auth.js';
import { ForumControl } from './forum-control.js';
import { ForumStore } from './forum-store.js';
/** Dedicated extension protocol: explicit replies bypass the web API envelope. */
@Controller(['collector/pokergosu/v1', ''])
export class ForumController {
  private readonly logger = new Logger(ForumController.name);
  private readonly control: ForumControl;
  constructor(private readonly store: ForumStore) {
    this.control = new ForumControl(store);
  }
  private async reply(
    request: FastifyRequest,
    response: FastifyReply,
    action: (principal: CollectorPrincipal) => Promise<unknown>,
  ) {
    try {
      const principal = await this.store.authenticate(request.headers);
      response.send(await action(principal));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'COLLECTOR_UNAVAILABLE';
      const forbidden = ['COLLECTOR_FORBIDDEN', 'INVALID_COLLECTOR_TOKEN'].includes(code);
      const status = forbidden
        ? 403
        : code === 'COLLECTOR_RECEIPT_CONFLICT'
          ? 409
          : error instanceof ZodError ||
              error instanceof PokergosuContractError ||
              code.startsWith('INVALID_')
            ? 400
            : 503;
      if (status >= 500)
        this.logger.error(
          {
            event: 'collector_request_failed',
            kind: error instanceof Error ? error.name : 'unknown',
          },
          'Collector request did not complete',
        );
      response.code(status).send({
        error:
          status >= 500
            ? 'COLLECTOR_UNAVAILABLE'
            : forbidden
              ? 'FORBIDDEN'
              : error instanceof ZodError
                ? 'INVALID_REQUEST'
                : code,
      });
    }
  }
  @Get('status') status(@Req() request: FastifyRequest, @Res() response: FastifyReply) {
    return this.reply(request, response, (p) => this.store.status(p));
  }
  @Get('plan') plan(@Req() request: FastifyRequest, @Res() response: FastifyReply) {
    return this.reply(request, response, (p) => this.store.plan(p));
  }
  @Get('strategy') strategy(
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
    @Query('cycle') cycle: string,
  ) {
    return this.reply(request, response, (p) =>
      this.store.strategy(p, z.coerce.number().int().min(1).max(1e12).parse(cycle)),
    );
  }
  @Post('capture')
  @RouteConfig({ bodyLimit: 2 * 1024 * 1024 })
  capture(@Req() request: FastifyRequest, @Res() response: FastifyReply, @Body() body: unknown) {
    return this.reply(request, response, (p) => this.store.capture(p, body));
  }
  @Post('search/plan') searchPlan(
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.reply(request, response, (p) => this.store.searchPlan(p, body));
  }
  @Post('control/poll') controlPoll(
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.reply(request, response, (p) => this.control.poll(p, body));
  }
  @Post('control/ack') controlAck(
    @Req() request: FastifyRequest,
    @Res() response: FastifyReply,
    @Body() body: unknown,
  ) {
    return this.reply(request, response, (p) => this.control.ack(p, body));
  }
}
