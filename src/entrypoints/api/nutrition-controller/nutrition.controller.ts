import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SortQueryDto } from '../dto/sort.dto';
import { PreviewNutritionGoalQueryDto, SetNutritionGoalDto } from './dto/nutrition-goal.dto';
import {
  NutritionGoalResponseDto,
  NutritionTargetsResponseDto,
} from './dto/nutrition-goal.response.dto';
import { NutritionControllerService } from './nutrition-controller.service';

/** Daily nutrition goals. Every change is a new goal; the history is kept. */
@ApiTags('Nutrition')
@Controller('nutrition/goals')
export class NutritionController {
  constructor(private readonly nutritionControllerService: NutritionControllerService) {}

  /** By `effectiveFrom`; `sortOrder` defaults to `desc` (newest first). */
  @Get()
  async getHistory(@Query() query: SortQueryDto): Promise<NutritionGoalResponseDto[]> {
    return this.nutritionControllerService.getHistory(query);
  }

  /** 404 until a goal is set. */
  @Get('current')
  async getCurrent(): Promise<NutritionGoalResponseDto> {
    return this.nutritionControllerService.getCurrent();
  }

  /**
   * What `POST /calculate` would save for the current profile. With `caloriesKcal`, splits those
   * calories into macros for the profile instead (400 below the minimum for the profile sex).
   */
  @Get('preview')
  async preview(
    @Query() query: PreviewNutritionGoalQueryDto,
  ): Promise<NutritionTargetsResponseDto> {
    return this.nutritionControllerService.preview(query);
  }

  /**
   * Sets the targets by hand (`calculation_mode = manual`). 400 when the calories are below
   * 1200 kcal for women or 1500 kcal for men, when protein, fat and carbs do not add up to the
   * calories (±10 %) or leave the healthy ranges (protein 10-35 %, fat 20-35 %, carbs 45-65 %).
   */
  @Post()
  async setManual(@Body() dto: SetNutritionGoalDto): Promise<NutritionGoalResponseDto> {
    return this.nutritionControllerService.setManual(dto);
  }

  /** Calculates the targets from the profile and saves them (`rule_based`). */
  @Post('calculate')
  async calculate(): Promise<NutritionGoalResponseDto> {
    return this.nutritionControllerService.calculate();
  }
}
