import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';

type UpdateUser = Partial<
  Pick<User, 'email' | 'password' | 'isEmailVerified' | 'emailVerifiedAt' | 'lastLoginAt'>
>;

@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  private source(dbManager?: EntityManager): Repository<User> {
    return dbManager ? dbManager.getRepository(User) : this.repository;
  }

  public async create(data: DeepPartial<User>, dbManager?: EntityManager): Promise<User> {
    const source = this.source(dbManager);
    return source.save(source.create(data));
  }

  public async findById(id: string, dbManager?: EntityManager): Promise<User | null> {
    return this.source(dbManager).findOne({ where: { id }, relations: { profile: true } });
  }

  public async findByEmail(email: string, dbManager?: EntityManager): Promise<User | null> {
    return this.source(dbManager).findOne({ where: { email }, relations: { profile: true } });
  }

  /** Same as `findByEmail`, plus the password hash that is excluded by default. */
  public async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.profile', 'profile')
      .where('user.email = :email', { email })
      .getOne();
  }

  public async findPasswordHash(id: string): Promise<string | null> {
    const user = await this.repository
      .createQueryBuilder('user')
      .select(['user.id', 'user.password'])
      .where('user.id = :id', { id })
      .getOne();
    return user?.password ?? null;
  }

  public async existsByEmail(email: string): Promise<boolean> {
    return this.repository.existsBy({ email });
  }

  public async update(id: string, data: UpdateUser, dbManager?: EntityManager): Promise<void> {
    await this.source(dbManager).update({ id }, data);
  }
}
