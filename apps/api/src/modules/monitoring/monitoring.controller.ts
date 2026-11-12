import { Controller, Get, Param, Query } from '@nestjs/common';
import { MonitoringListDto, MonitoringScopeDto } from './dto/monitoring-query.dto.js';
import { MonitoringService } from './monitoring.service.js';

@Controller('api/v1/monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Get('overview') overview(@Query() query: MonitoringScopeDto) {
    return this.monitoring.overview(query);
  }
  @Get('conversations') conversations(@Query() query: MonitoringListDto) {
    return this.monitoring.conversations(query);
  }
  @Get('conversations/:id') detail(@Param('id') id: string) {
    return this.monitoring.detail(id);
  }
  @Get('classifications') classifications(@Query() query: MonitoringListDto) {
    return this.monitoring.classifications(query);
  }
}
