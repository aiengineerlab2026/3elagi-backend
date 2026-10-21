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
import { Hospital } from './hospital.entity';

/** Surgical operations per speciality: the admin catalog plus hospitals' custom ones. */
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

  /** Set = a custom surgery added by this hospital; null = predefined catalog. */
  @Column({ type: 'uuid', nullable: true })
  hospital_id: string | null;

  @ManyToOne(() => Hospital, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'hospital_id' })
  hospital?: Hospital | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
