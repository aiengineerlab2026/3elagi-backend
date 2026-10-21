import { MigrationInterface, QueryRunner } from 'typeorm';

/** Doctors can propose slot windows; the hospital approves or rejects them. */
export class HospitalSlotProposals1778860000000 implements MigrationInterface {
  name = 'HospitalSlotProposals1778860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing windows were set by hospitals, so they are approved.
    await queryRunner.query(`
      ALTER TABLE "hospital_operation_slots"
      ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'approved'
    `);
    await queryRunner.query(`
      ALTER TABLE "hospital_operation_slots"
      ADD COLUMN IF NOT EXISTS "created_by" varchar(16) NOT NULL DEFAULT 'hospital'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "hospital_operation_slots" DROP COLUMN IF EXISTS "created_by"`);
    await queryRunner.query(`ALTER TABLE "hospital_operation_slots" DROP COLUMN IF EXISTS "status"`);
  }
}
