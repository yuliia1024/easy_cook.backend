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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error.response.dto';
import { MenuListQueryDto, RenameMenuDto } from './dto/menu.dto';
import { MenuResponseDto, MenuSummaryResponseDto } from './dto/menu.response.dto';
import { MenuControllerService } from './menu-controller.service';

/**
 * Menus and their immutable versions. The API does not create menus or add versions (the chat
 * saves the menus it generates as drafts); it reads, renames and deletes them, and a version
 * becomes the menu only when it is confirmed.
 */
@ApiTags('Menus')
@Controller('menus')
export class MenuController {
  constructor(private readonly menuControllerService: MenuControllerService) {}

  /** The confirmed menus, or the ones of `status`. */
  @Get()
  async getAll(@Query() query: MenuListQueryDto): Promise<MenuSummaryResponseDto[]> {
    return this.menuControllerService.getAll(query);
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

  @Post(':id/versions/:versionId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a version of the menu',
    description:
      'Makes the version the confirmed one of its menu. For a menu planned in the chat, take the ids ' +
      'from the reply: `menuId` and `versionId` of the `data-menu` stream part, or `menuId` and ' +
      '`menuVersionId` of the saved assistant message. The version is checked again against the ' +
      'current goal and dietary preferences first, since they may have changed since it was built. ' +
      'Confirming another version of the same menu replaces the confirmed one; confirming the ' +
      'confirmed version again only updates `confirmedAt`. A confirmed menu is listed by ' +
      '`GET /menus` (without `status`), a menu without one only with `status=draft` or `all`.',
  })
  @ApiOkResponse({
    type: MenuResponseDto,
    description:
      'The whole menu: `confirmedVersionId` is the version, `confirmedAt` the time, and the ' +
      'version has `isConfirmed: true`.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'The version breaks a hard rule of the current preferences (diet, allergy, excluded ' +
      'ingredient); `message` lists the problems. The confirmed version stays as it was. Also for ' +
      'an id that is not a UUID.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Unknown menu or a version of another menu; or no profile yet.',
  })
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<MenuResponseDto> {
    return this.menuControllerService.confirm(id, versionId);
  }
}
