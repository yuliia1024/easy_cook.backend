import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SetNutritionGoalDto } from './dto/nutrition-goal.dto';
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

  /** Newest first. */
  @Get()
  async getHistory(): Promise<NutritionGoalResponseDto[]> {
    return this.nutritionControllerService.getHistory();
  }

  /** 404 until a goal is set. */
  @Get('current')
  async getCurrent(): Promise<NutritionGoalResponseDto> {
    return this.nutritionControllerService.getCurrent();
  }

  /** What `POST /calculate` would save for the current profile. */
  @Get('preview')
  async preview(): Promise<NutritionTargetsResponseDto> {
    return this.nutritionControllerService.preview();
  }

  /** Sets the targets by hand (`calculation_mode = manual`). */
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
