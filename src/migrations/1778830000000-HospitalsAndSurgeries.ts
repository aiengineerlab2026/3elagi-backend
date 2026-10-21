import { MigrationInterface, QueryRunner } from 'typeorm';

export class HospitalsAndSurgeries1778830000000 implements MigrationInterface {
  name = 'HospitalsAndSurgeries1778830000000';
  // ALTER TYPE ... ADD VALUE must run outside a transaction block; every
  // statement below is IF NOT EXISTS so a partial run is safe to re-run.
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'hospital'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "surgical_operations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name_en" varchar(120) NOT NULL,
        "name_ar" varchar(120) NOT NULL,
        "speciality_id" uuid NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgical_operations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgical_operations_speciality"
          FOREIGN KEY ("speciality_id") REFERENCES "doctor_specialities"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_surgical_operations_speciality"
      ON "surgical_operations" ("speciality_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hospitals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(160) NOT NULL,
        "location" text NOT NULL DEFAULT '',
        "description" text NOT NULL DEFAULT '',
        "phone" varchar(32) NOT NULL DEFAULT '',
        "owner_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hospitals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_hospitals_owner" UNIQUE ("owner_id"),
        CONSTRAINT "FK_hospitals_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hospital_doctors" (
        "hospital_id" uuid NOT NULL,
        "doctor_id" uuid NOT NULL,
        CONSTRAINT "PK_hospital_doctors" PRIMARY KEY ("hospital_id", "doctor_id"),
        CONSTRAINT "FK_hospital_doctors_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_hospital_doctors_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hospital_doctors_doctor"
      ON "hospital_doctors" ("doctor_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "hospital_operation_slots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "hospital_id" uuid NOT NULL,
        "operation_id" uuid NOT NULL,
        "day_of_week" smallint NOT NULL,
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "slot_minutes" int NOT NULL DEFAULT 60,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_hospital_operation_slots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_hospital_operation_slots_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_hospital_operation_slots_operation"
          FOREIGN KEY ("operation_id") REFERENCES "surgical_operations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hospital_operation_slots_hospital_op"
      ON "hospital_operation_slots" ("hospital_id", "operation_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "surgery_reservations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "hospital_id" uuid NOT NULL,
        "operation_id" uuid NOT NULL,
        "doctor_id" uuid NOT NULL,
        "patient_user_id" uuid NOT NULL,
        "date" date NOT NULL,
        "time" time NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "notes" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_surgery_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_surgery_reservations_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_reservations_operation"
          FOREIGN KEY ("operation_id") REFERENCES "surgical_operations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_reservations_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_surgery_reservations_patient"
          FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_surgery_reservations_hospital"
      ON "surgery_reservations" ("hospital_id", "date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_surgery_reservations_patient"
      ON "surgery_reservations" ("patient_user_id")
    `);
    // One live reservation per hospital/operation slot, and per doctor/time.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_surgery_reservations_slot"
      ON "surgery_reservations" ("hospital_id", "operation_id", "date", "time")
      WHERE "status" IN ('pending', 'approved')
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_surgery_reservations_doctor_time"
      ON "surgery_reservations" ("doctor_id", "date", "time")
      WHERE "status" IN ('pending', 'approved')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "surgery_reservations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hospital_operation_slots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hospital_doctors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hospitals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "surgical_operations"`);
    // Postgres cannot drop a single enum value; 'hospital' stays on users_role_enum.
  }
}
