import { Injectable } from '@nestjs/common';
import { AgentRun, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';

/** A finished run of the chat agent (`agent_runs`). */
export type AgentRunData = Omit<
  Prisma.AgentRunUncheckedCreateInput,
  'id' | 'createdAt' | 'modelCalls' | 'toolCalls'
> & {
  modelCalls: unknown[];
  toolCalls: unknown[];
};

/** The audit log of the chat agent: runs are only added, never updated. */
@Injectable()
export class AgentRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async create({ modelCalls, toolCalls, ...data }: AgentRunData): Promise<AgentRun> {
    return this.prisma.agentRun.create({
      data: {
        ...data,
        modelCalls: modelCalls as Prisma.InputJsonValue,
        toolCalls: toolCalls as Prisma.InputJsonValue,
      },
    });
  }
}
