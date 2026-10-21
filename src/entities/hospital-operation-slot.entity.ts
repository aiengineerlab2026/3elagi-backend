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

/**
 * Weekly availability window for one operation at one hospital — same shape as
 * doctor_schedules. The operations a hospital supports are the ones with rows here.
 */
@Entity('hospital_operation_slots')
@Index('IDX_hospital_operation_slots_hospital_op', ['hospital_id', 'operation_id'])
export class HospitalOperationSlot {
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

  @Column({ type: 'smallint' })
  day_of_week: number;

  @Column({ type: 'time' })
  start_time: string;

  @Column({ type: 'time' })
  end_time: string;

  @Column({ type: 'int', default: 60 })
  slot_minutes: number;

  @CreateDateColumn()
  created_at: Date;
}
