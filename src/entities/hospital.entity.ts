import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import type { ApprovalStatus } from './doctor.entity';

@Entity('hospitals')
export class Hospital {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 160 })
  name: string;

  @Column({ type: 'text', default: '' })
  location: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 32, default: '' })
  phone: string;

  /** Hospital account that manages this row; null for admin-created hospitals. */
  @Column({ type: 'uuid', nullable: true, unique: true })
  owner_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User | null;

  /** Admin can hide a hospital from patients without deleting it. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** Self-registered hospitals wait for admin approval before patients see them. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  approval_status: ApprovalStatus;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
