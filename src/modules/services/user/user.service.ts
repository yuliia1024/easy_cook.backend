import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UserNotFoundException } from '../../../common/exceptions';
import { User } from '../../data-access/user/user.entity';
import { UserRepository } from '../../data-access/user/user.repository';
import { PasswordService } from '../password/password.service';

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
  ) {}

  /** Emails are compared and stored lower-cased and trimmed. */
  public static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  public async getById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new UserNotFoundException();
    }
    return user;
  }

  public async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(UserService.normalizeEmail(email));
  }

  public async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userRepository.findByEmailWithPassword(UserService.normalizeEmail(email));
  }

  public async isEmailTaken(email: string): Promise<boolean> {
    return this.userRepository.existsByEmail(UserService.normalizeEmail(email));
  }

  public async create(email: string, password: string, dbManager?: EntityManager): Promise<User> {
    return this.userRepository.create(
      {
        email: UserService.normalizeEmail(email),
        password: await this.passwordService.hash(password),
      },
      dbManager,
    );
  }

  public async markEmailVerified(id: string): Promise<void> {
    await this.userRepository.update(id, { isEmailVerified: true, emailVerifiedAt: new Date() });
  }

  public async markLoggedIn(id: string): Promise<void> {
    await this.userRepository.update(id, { lastLoginAt: new Date() });
  }

  public async setPassword(id: string, password: string): Promise<void> {
    await this.userRepository.update(id, { password: await this.passwordService.hash(password) });
  }

  public async isPasswordValid(id: string, password: string): Promise<boolean> {
    return this.passwordService.compare(password, await this.userRepository.findPasswordHash(id));
  }

  public async changeEmail(id: string, email: string): Promise<void> {
    await this.userRepository.update(id, {
      email: UserService.normalizeEmail(email),
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
    });
  }
}
