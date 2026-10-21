import { MigrationInterface, QueryRunner } from 'typeorm';

/** Hospitals can add their own surgeries; null hospital_id = predefined / admin catalog. */
export class HospitalCustomOperations1778900000000 implements MigrationInterface {
  name = 'HospitalCustomOperations1778900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "surgical_operations" ADD COLUMN IF NOT EXISTS "hospital_id" uuid`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "surgical_operations"
          ADD CONSTRAINT "FK_surgical_operations_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "surgical_operations" DROP COLUMN IF EXISTS "hospital_id"`);
  }
}
