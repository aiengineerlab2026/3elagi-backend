import { MigrationInterface, QueryRunner } from 'typeorm';

/** Slot windows belong to a specific doctor + operation at a hospital. */
export class HospitalSlotsPerDoctor1778850000000 implements MigrationInterface {
  name = 'HospitalSlotsPerDoctor1778850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "hospital_operation_slots" ADD COLUMN IF NOT EXISTS "doctor_id" uuid`,
    );
    // Windows without a doctor cannot be booked in the new model.
    await queryRunner.query(`DELETE FROM "hospital_operation_slots" WHERE "doctor_id" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "hospital_operation_slots" ALTER COLUMN "doctor_id" SET NOT NULL`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "hospital_operation_slots"
          ADD CONSTRAINT "FK_hospital_operation_slots_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hospital_operation_slots_doctor"
      ON "hospital_operation_slots" ("hospital_id", "operation_id", "doctor_id")
    `);

    // null doctor_id = the exception applies to every doctor.
    await queryRunner.query(
      `ALTER TABLE "hospital_slot_overrides" ADD COLUMN IF NOT EXISTS "doctor_id" uuid`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "hospital_slot_overrides"
          ADD CONSTRAINT "FK_hospital_slot_overrides_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Two doctors may run the same operation at the same time; the per-doctor
    // unique index (UQ_surgery_reservations_doctor_time) still prevents double booking.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_surgery_reservations_slot"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_surgery_reservations_slot"
      ON "surgery_reservations" ("hospital_id", "operation_id", "date", "time")
      WHERE "status" IN ('pending', 'approved')
    `);
    await queryRunner.query(`ALTER TABLE "hospital_slot_overrides" DROP COLUMN IF EXISTS "doctor_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hospital_operation_slots_doctor"`);
    await queryRunner.query(`ALTER TABLE "hospital_operation_slots" DROP COLUMN IF EXISTS "doctor_id"`);
  }
}
