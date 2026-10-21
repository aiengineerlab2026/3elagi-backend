import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Hospital } from './hospital.entity';
import { SurgicalOperation } from './surgical-operation.entity';
import { Doctor } from './doctor.entity';

/**
 * Date exception for hospital slots — same idea as doctor_schedule_overrides.
 * operation_id / doctor_id null = applies to every operation / doctor (e.g. a hospital holiday).
 */
@Entity('hospital_slot_overrides')
@Index('IDX_hospital_slot_overrides_dates', ['hospital_id', 'start_date', 'end_date'])
export class HospitalSlotOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  hospital_id: string;

  @ManyToOne(() => Hospital, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hospital_id' })
  hospital?: Hospital;

  @Column({ type: 'uuid', nullable: true })
  operation_id: string | null;

  @ManyToOne(() => SurgicalOperation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'operation_id' })
  operation?: SurgicalOperation | null;

  @Column({ type: 'uuid', nullable: true })
  doctor_id: string | null;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'doctor_id' })
  doctor?: Doctor | null;

  @Column({ type: 'date' })
  start_date: string;

  @Column({ type: 'date' })
  end_date: string;

  @Column({ type: 'boolean', default: false })
  is_closed: boolean;

  @Column({ type: 'time', nullable: true })
  start_time: string | null;

  @Column({ type: 'time', nullable: true })
  end_time: string | null;

  @Column({ type: 'int', nullable: true })
  slot_minutes: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;

  @CreateDateColumn()
  created_at: Date;
}
