import { Injectable } from '@nestjs/common';
import { NutritionGoalService } from '../../../modules/services/nutrition-goal/nutrition-goal.service';
import { SortQueryDto } from '../dto/sort.dto';
import { PreviewNutritionGoalQueryDto, SetNutritionGoalDto } from './dto/nutrition-goal.dto';
import {
  NutritionGoalResponseDto,
  NutritionTargetsResponseDto,
} from './dto/nutrition-goal.response.dto';

@Injectable()
export class NutritionControllerService {
  constructor(private readonly nutritionGoalService: NutritionGoalService) {}

  public async getCurrent(): Promise<NutritionGoalResponseDto> {
    return NutritionGoalResponseDto.from(await this.nutritionGoalService.getCurrent());
  }

  public async getHistory({ sortOrder }: SortQueryDto): Promise<NutritionGoalResponseDto[]> {
    const goals = await this.nutritionGoalService.getHistory(sortOrder);
    return goals.map(NutritionGoalResponseDto.from);
  }

  public async setManual({
    effectiveFrom,
    ...targets
  }: SetNutritionGoalDto): Promise<NutritionGoalResponseDto> {
    return NutritionGoalResponseDto.from(
      await this.nutritionGoalService.setManual(targets, effectiveFrom),
    );
  }

  public async preview({
    caloriesKcal,
  }: PreviewNutritionGoalQueryDto): Promise<NutritionTargetsResponseDto> {
    return this.nutritionGoalService.preview(caloriesKcal);
  }

  public async calculate(): Promise<NutritionGoalResponseDto> {
    return NutritionGoalResponseDto.from(await this.nutritionGoalService.calculate());
  }
}
