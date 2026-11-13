import { Module } from '@nestjs/common';
import { AssetRepository } from './asset.repository.js';
@Module({ providers: [AssetRepository], exports: [AssetRepository] })
export class AssetsModule {}
