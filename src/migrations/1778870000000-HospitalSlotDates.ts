import { MigrationInterface, QueryRunner } from 'typeorm';

/** One-off slot windows on a specific date (doctor calendar proposals). */
export class HospitalSlotDates1778870000000 implements MigrationInterface {
  name = 'HospitalSlotDates1778870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hospital_operation_slots" ADD COLUMN IF NOT EXISTS "date" date`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hospital_operation_slots_date"
      ON "hospital_operation_slots" ("hospital_id", "doctor_id", "date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hospital_operation_slots_date"`);
    await queryRunner.query(`ALTER TABLE "hospital_operation_slots" DROP COLUMN IF EXISTS "date"`);
  }
}
