import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Hospital } from './hospital.entity';
import { Doctor } from './doctor.entity';
import type { ApprovalStatus } from './doctor.entity';

/** Hospital ↔ doctor link. The hospital invites; only doctor-approved links are bookable. */
@Entity('hospital_doctors')
export class HospitalDoctor {
  @PrimaryColumn('uuid')
  hospital_id: string;

  @PrimaryColumn('uuid')
  doctor_id: string;

  @ManyToOne(() => Hospital, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hospital_id' })
  hospital?: Hospital;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ApprovalStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
