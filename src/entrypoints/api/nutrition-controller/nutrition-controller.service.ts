import { Injectable } from '@nestjs/common';
import { NutritionGoalService } from '../../../modules/services/nutrition-goal/nutrition-goal.service';
import { SetNutritionGoalDto } from './dto/nutrition-goal.dto';
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

  public async getHistory(): Promise<NutritionGoalResponseDto[]> {
    const goals = await this.nutritionGoalService.getHistory();
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

  public async preview(): Promise<NutritionTargetsResponseDto> {
    return this.nutritionGoalService.preview();
  }

  public async calculate(): Promise<NutritionGoalResponseDto> {
    return NutritionGoalResponseDto.from(await this.nutritionGoalService.calculate());
  }
}
