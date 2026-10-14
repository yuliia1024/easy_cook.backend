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
  Res,
} from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { pipeUIMessageStreamToResponse } from 'ai';
import { Response } from 'express';
import {
  CreateMenuDto,
  GenerateMenuDto,
  MenuVersionDto,
  RenameMenuDto,
  ReplaceMealDto,
} from './dto/menu.dto';
import { MenuResponseDto, MenuSummaryResponseDto } from './dto/menu.response.dto';
import { MenuControllerService } from './menu-controller.service';

/**
 * Menus and their immutable versions. Every change adds a version; a version becomes the menu
 * only when it is confirmed.
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

  /** A menu put together by hand. 400 for unknown recipes or broken dietary rules. */
  @Post()
  async create(@Body() dto: CreateMenuDto): Promise<MenuResponseDto> {
    return this.menuControllerService.create(dto);
  }

  /**
   * Not implemented yet: an AI SDK UI message stream (SSE) of `start` and an `error` chunk. The
   * body is still validated.
   */
  @Post('generate')
  @ApiProduces('text/event-stream')
  async generate(@Body() _dto: GenerateMenuDto, @Res() response: Response): Promise<void> {
    const stream = this.menuControllerService.generate();
    await pipeUIMessageStreamToResponse({ response, status: HttpStatus.CREATED, stream });
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

  /** The whole next version, edited by hand; same rules as creating a menu. */
  @Post(':id/versions')
  async addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MenuVersionDto,
  ): Promise<MenuResponseDto> {
    return this.menuControllerService.addVersion(id, dto);
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

  /**
   * A new version where the assistant picked another recipe for one meal. Only the new meal must
   * follow the rules, so a menu can be fixed meal by meal after the preferences change.
   */
  @Post(':id/replace-meal')
  async replaceMeal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceMealDto,
  ): Promise<MenuResponseDto> {
    return this.menuControllerService.replaceMeal(id, dto);
  }
}
