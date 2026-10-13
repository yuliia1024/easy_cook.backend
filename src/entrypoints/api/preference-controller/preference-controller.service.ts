import { Injectable } from '@nestjs/common';
import { DietaryPreferenceService } from '../../../modules/services/dietary-preference/dietary-preference.service';
import { CreatePreferenceDto } from './dto/preference.dto';
import { PreferenceResponseDto } from './dto/preference.response.dto';

@Injectable()
export class PreferenceControllerService {
  constructor(private readonly dietaryPreferenceService: DietaryPreferenceService) {}

  public async getAll(): Promise<PreferenceResponseDto[]> {
    const preferences = await this.dietaryPreferenceService.getAll();
    return preferences.map(PreferenceResponseDto.from);
  }

  public async add(dto: CreatePreferenceDto): Promise<PreferenceResponseDto> {
    return PreferenceResponseDto.from(await this.dietaryPreferenceService.add(dto));
  }

  public async remove(id: string): Promise<void> {
    await this.dietaryPreferenceService.remove(id);
  }
}
