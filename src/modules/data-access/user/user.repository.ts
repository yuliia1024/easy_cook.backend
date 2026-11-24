import { Injectable } from '@nestjs/common';
import { User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';

export interface UserData {
  email: string;
  googleSub: string | null;
  name: string | null;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  public async findByGoogleSub(googleSub: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleSub } });
  }

  /** `email` in lower case, as stored. */
  public async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  public async create(data: UserData): Promise<User> {
    return this.prisma.user.create({ data });
  }

  public async update(id: string, data: Partial<UserData>): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
}
