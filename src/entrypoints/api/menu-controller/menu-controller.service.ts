import { Injectable } from '@nestjs/common';
import { MenuService } from '../../../modules/services/menu/menu.service';
import { MenuResponseDto, MenuSummaryResponseDto } from './dto/menu.response.dto';

@Injectable()
export class MenuControllerService {
  constructor(private readonly menuService: MenuService) {}

  public async getAll(): Promise<MenuSummaryResponseDto[]> {
    const menus = await this.menuService.getAll();
    return menus.map(MenuSummaryResponseDto.from);
  }

  public async getById(id: string): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.getById(id));
  }
}
