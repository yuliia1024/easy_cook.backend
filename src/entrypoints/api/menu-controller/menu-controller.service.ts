import { Injectable } from '@nestjs/common';
import { MenuService } from '../../../modules/services/menu/menu.service';
import { RenameMenuDto } from './dto/menu.dto';
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

  public async rename(id: string, { title }: RenameMenuDto): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.rename(id, title));
  }

  public async delete(id: string): Promise<void> {
    await this.menuService.delete(id);
  }

  public async confirm(id: string, versionId: string): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.confirm(id, versionId));
  }
}
