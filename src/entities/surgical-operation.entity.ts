import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DoctorSpeciality } from './doctor-speciality.entity';

/** Admin-managed catalog of predefined surgical operations, per speciality. */
@Entity('surgical_operations')
@Index('IDX_surgical_operations_speciality', ['speciality_id'])
export class SurgicalOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 120 })
  name_en: string;

  @Column({ length: 120 })
  name_ar: string;

  @Column('uuid')
  speciality_id: string;

  @ManyToOne(() => DoctorSpeciality, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'speciality_id' })
  speciality?: DoctorSpeciality;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
