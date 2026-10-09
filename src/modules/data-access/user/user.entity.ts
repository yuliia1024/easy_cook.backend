import { Column, Entity, Index, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampsEntity } from '../../../common/types';
import { UserProfile } from '../user-profile/user-profile.entity';

@Entity('users')
export class User extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Always stored lower-cased (see `UserService`), so the unique index is case-insensitive. */
  @Index('UQ_users_email', { unique: true })
  @Column({ length: 254 })
  email: string;

  @Column({ select: false })
  password: string;

  @Column({ default: false })
  isEmailVerified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @OneToOne(() => UserProfile, (profile) => profile.user)
  profile?: UserProfile | null;
}
