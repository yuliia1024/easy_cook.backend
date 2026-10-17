import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RenameMenuDto } from './dto/menu.dto';
import { MenuResponseDto, MenuSummaryResponseDto } from './dto/menu.response.dto';
import { MenuControllerService } from './menu-controller.service';

/**
 * Menus and their immutable versions. The API does not create menus or add versions; it reads,
 * renames and deletes them, and a version becomes the menu only when it is confirmed.
 */
@ApiTags('Menus')
@Controller('menus')
export class MenuController {
  constructor(private readonly menuControllerService: MenuControllerService) {}

  @Get()
  async getAll(): Promise<MenuSummaryResponseDto[]> {
    return this.menuControllerService.getAll();
  }

  /** With every version, newest first. */
  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<MenuResponseDto> {
    return this.menuControllerService.getById(id);
  }

  @Patch(':id')
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameMenuDto,
  ): Promise<MenuResponseDto> {
    return this.menuControllerService.rename(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.menuControllerService.delete(id);
  }

  /** 400 when the version breaks the current dietary preferences. */
  @Post(':id/versions/:versionId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<MenuResponseDto> {
    return this.menuControllerService.confirm(id, versionId);
  }
}
