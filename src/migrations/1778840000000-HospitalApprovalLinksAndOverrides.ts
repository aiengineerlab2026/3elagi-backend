import { MigrationInterface, QueryRunner } from 'typeorm';

export class HospitalApprovalLinksAndOverrides1778840000000 implements MigrationInterface {
  name = 'HospitalApprovalLinksAndOverrides1778840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rows that already exist were live before approvals existed — keep them
    // approved; new rows default to pending.
    await queryRunner.query(`
      ALTER TABLE "hospitals"
      ADD COLUMN IF NOT EXISTS "approval_status" varchar(16) NOT NULL DEFAULT 'approved'
    `);
    await queryRunner.query(
      `ALTER TABLE "hospitals" ALTER COLUMN "approval_status" SET DEFAULT 'pending'`,
    );

    await queryRunner.query(`
      ALTER TABLE "hospital_doctors"
      ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'approved'
    `);
    await queryRunner.query(
      `ALTER TABLE "hospital_doctors" ALTER COLUMN "status" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(`
      ALTER TABLE "hospital_doctors"
      ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hospital_slot_overrides" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "hospital_id" uuid NOT NULL,
        "operation_id" uuid,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "is_closed" boolean NOT NULL DEFAULT false,
        "start_time" time,
        "end_time" time,
        "slot_minutes" int,
        "note" varchar(200),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hospital_slot_overrides" PRIMARY KEY ("id"),
        CONSTRAINT "FK_hospital_slot_overrides_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_hospital_slot_overrides_operation"
          FOREIGN KEY ("operation_id") REFERENCES "surgical_operations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hospital_slot_overrides_dates"
      ON "hospital_slot_overrides" ("hospital_id", "start_date", "end_date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "hospital_slot_overrides"`);
    await queryRunner.query(`ALTER TABLE "hospital_doctors" DROP COLUMN IF EXISTS "created_at"`);
    await queryRunner.query(`ALTER TABLE "hospital_doctors" DROP COLUMN IF EXISTS "status"`);
    await queryRunner.query(`ALTER TABLE "hospitals" DROP COLUMN IF EXISTS "approval_status"`);
  }
}
