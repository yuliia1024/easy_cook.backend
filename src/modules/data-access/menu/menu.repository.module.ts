import { Module } from '@nestjs/common';
import { MenuRepository } from './menu.repository';

@Module({
  providers: [MenuRepository],
  exports: [MenuRepository],
})
export class MenuRepositoryModule {}
