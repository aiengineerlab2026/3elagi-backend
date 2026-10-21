import { MigrationInterface, QueryRunner } from 'typeorm';

/** Surgery reservations need both the hospital and the doctor to approve. */
export class ReservationDualApproval1778910000000 implements MigrationInterface {
  name = 'ReservationDualApproval1778910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_reservations"
        ADD COLUMN IF NOT EXISTS "hospital_status" varchar(16) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS "doctor_status" varchar(16) NOT NULL DEFAULT 'pending'
    `);
    // Earlier decisions were the hospital's alone; approved ones count as approved by both.
    await queryRunner.query(`
      UPDATE "surgery_reservations" SET
        "hospital_status" = CASE WHEN "status" IN ('approved', 'rejected') THEN "status" ELSE 'pending' END,
        "doctor_status" = CASE WHEN "status" = 'approved' THEN 'approved' ELSE 'pending' END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_reservations"
        DROP COLUMN IF EXISTS "doctor_status",
        DROP COLUMN IF EXISTS "hospital_status"
    `);
  }
}
