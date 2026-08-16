import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Liveness plus a database round-trip' })
  async check() {
    const startedAt = Date.now();
    await this.dataSource.query('SELECT 1');

    return {
      status: 'ok',
      database: { connected: this.dataSource.isInitialized, latencyMs: Date.now() - startedAt },
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
