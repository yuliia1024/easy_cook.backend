import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreatePreferenceDto } from './dto/preference.dto';
import { PreferenceResponseDto } from './dto/preference.response.dto';
import { PreferenceControllerService } from './preference-controller.service';

/** Diets, allergies, disliked and excluded foods of the profile. */
@ApiTags('Preferences')
@Controller('preferences')
export class PreferenceController {
  constructor(private readonly preferenceControllerService: PreferenceControllerService) {}

  @Get()
  async getAll(): Promise<PreferenceResponseDto[]> {
    return this.preferenceControllerService.getAll();
  }

  /** 409 for a duplicate, 400 for an unknown diet. */
  @Post()
  async add(@Body() dto: CreatePreferenceDto): Promise<PreferenceResponseDto> {
    return this.preferenceControllerService.add(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.preferenceControllerService.remove(id);
  }
}
