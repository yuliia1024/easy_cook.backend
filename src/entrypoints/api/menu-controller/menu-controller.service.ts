import { Injectable } from '@nestjs/common';
import { createUIMessageStream, UIMessageChunk } from 'ai';
import { MenuDayDraft } from '../../../common/types';
import { toDate } from '../../../common/utils';
import { MenuService } from '../../../modules/services/menu/menu.service';
import {
  CreateMenuDto,
  MenuDayDto,
  MenuVersionDto,
  RenameMenuDto,
  ReplaceMealDto,
} from './dto/menu.dto';
import { MenuResponseDto, MenuSummaryResponseDto } from './dto/menu.response.dto';

const GENERATION_NOT_IMPLEMENTED = 'Menu generation is not implemented yet';

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

  public async create({ title, ...version }: CreateMenuDto): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.create(title, this.toManual(version)));
  }

  /** Placeholder until menus are generated: a stream that only reports it is not implemented. */
  public generate(): ReadableStream<UIMessageChunk> {
    return createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start' });
        writer.write({ type: 'error', errorText: GENERATION_NOT_IMPLEMENTED });
      },
    });
  }

  public async rename(id: string, { title }: RenameMenuDto): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.rename(id, title));
  }

  public async delete(id: string): Promise<void> {
    await this.menuService.delete(id);
  }

  public async addVersion(id: string, dto: MenuVersionDto): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.addVersion(id, this.toManual(dto)));
  }

  public async confirm(id: string, versionId: string): Promise<MenuResponseDto> {
    return MenuResponseDto.from(await this.menuService.confirm(id, versionId));
  }

  public async replaceMeal(id: string, dto: ReplaceMealDto): Promise<MenuResponseDto> {
    const menu = await this.menuService.replaceMeal(id, {
      versionId: dto.versionId ?? null,
      dayIndex: dto.dayIndex,
      position: dto.position,
      instructions: dto.instructions || null,
    });
    return MenuResponseDto.from(menu);
  }

  private toManual({ notes, days }: MenuVersionDto): {
    notes: string | null;
    days: MenuDayDraft[];
  } {
    return { notes: notes || null, days: days.map((day) => this.toDay(day)) };
  }

  private toDay(day: MenuDayDto): MenuDayDraft {
    return {
      dayIndex: day.dayIndex,
      date: toDate(day.date),
      meals: day.meals.map(({ mealType, recipeId, servings }) => ({
        mealType,
        recipeId,
        servings,
      })),
    };
  }
}
