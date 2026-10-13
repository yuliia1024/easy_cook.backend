import { Module } from '@nestjs/common';
import { MenuModule } from '../../../modules/services/menu/menu.module';
import { MenuControllerService } from './menu-controller.service';
import { MenuController } from './menu.controller';

@Module({
  imports: [MenuModule],
  controllers: [MenuController],
  providers: [MenuControllerService],
})
export class MenuControllerModule {}
