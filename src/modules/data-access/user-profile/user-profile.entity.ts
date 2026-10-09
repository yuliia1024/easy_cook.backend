import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TimestampsEntity } from '../../../common/types';
import { Diet, FIRST_NAME_MAX_LENGTH, Gender } from '../../../common/constants';
import { User } from '../user/user.entity';

/** The user questionnaire. Created on the first `PUT /users/me/profile`. */
@Entity('user_profiles')
export class UserProfile extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Unique through the one-to-one join column (upserts conflict on it).
  @Column({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ length: FIRST_NAME_MAX_LENGTH })
  firstName: string;

  @Column({ type: 'enum', enum: Gender, enumName: 'user_gender' })
  gender: Gender;

  @Column({ type: 'enum', enum: Diet, enumName: 'user_diet' })
  diet: Diet;
}
