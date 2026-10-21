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
import { Hospital } from './hospital.entity';
import { SurgicalOperation } from './surgical-operation.entity';
import { Doctor } from './doctor.entity';
import { User } from './user.entity';

export type SurgeryReservationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

/** Statuses that hold the slot (a partial unique index enforces one per slot). */
export const ACTIVE_RESERVATION_STATUSES: SurgeryReservationStatus[] = [
  'pending',
  'approved',
];

@Entity('surgery_reservations')
@Index('IDX_surgery_reservations_hospital', ['hospital_id', 'date'])
@Index('IDX_surgery_reservations_patient', ['patient_user_id'])
export class SurgeryReservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hospital_id: string;

  @ManyToOne(() => Hospital, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hospital_id' })
  hospital?: Hospital;

  @Column('uuid')
  operation_id: string;

  @ManyToOne(() => SurgicalOperation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operation_id' })
  operation?: SurgicalOperation;

  @Column('uuid')
  doctor_id: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor;

  @Column('uuid')
  patient_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'patient_user_id' })
  patient?: User;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time' })
  time: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: SurgeryReservationStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
