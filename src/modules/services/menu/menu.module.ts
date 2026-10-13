import { Module } from '@nestjs/common';
import { MenuRepositoryModule } from '../../data-access/menu/menu.repository.module';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { MenuService } from './menu.service';

@Module({
  imports: [MenuRepositoryModule, UserProfileModule],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
