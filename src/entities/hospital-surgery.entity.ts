import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Hospital } from './hospital.entity';
import { SurgicalOperation } from './surgical-operation.entity';

/** A surgery the hospital offers and the doctors assigned to perform it there. */
@Entity('hospital_surgeries')
export class HospitalSurgery {
  @PrimaryColumn('uuid')
  hospital_id: string;

  @PrimaryColumn('uuid')
  operation_id: string;

  @ManyToOne(() => Hospital, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hospital_id' })
  hospital?: Hospital;

  @ManyToOne(() => SurgicalOperation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operation_id' })
  operation?: SurgicalOperation;

  @Column('uuid', { array: true, default: () => "'{}'" })
  doctor_ids: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
