import { MigrationInterface, QueryRunner } from 'typeorm';

/** Surgeries a hospital offers and the doctors assigned to perform each one. */
export class HospitalSurgeries1778880000000 implements MigrationInterface {
  name = 'HospitalSurgeries1778880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hospital_surgeries" (
        "hospital_id" uuid NOT NULL,
        "operation_id" uuid NOT NULL,
        "doctor_ids" uuid[] NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hospital_surgeries" PRIMARY KEY ("hospital_id", "operation_id"),
        CONSTRAINT "FK_hospital_surgeries_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_hospital_surgeries_operation"
          FOREIGN KEY ("operation_id") REFERENCES "surgical_operations"("id") ON DELETE CASCADE
      )
    `);
    // Existing slot windows imply the assignment — keep them valid.
    await queryRunner.query(`
      INSERT INTO "hospital_surgeries" ("hospital_id", "operation_id", "doctor_ids")
      SELECT "hospital_id", "operation_id", array_agg(DISTINCT "doctor_id")
      FROM "hospital_operation_slots"
      GROUP BY "hospital_id", "operation_id"
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "hospital_surgeries"`);
  }
}
