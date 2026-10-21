import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';
import { Hospital } from '../entities/hospital.entity';
import { HospitalDoctor } from '../entities/hospital-doctor.entity';
import { HospitalSlotOverride } from '../entities/hospital-slot-override.entity';
import { User } from '../entities/user.entity';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { MailModule } from '../mail/mail.module';
import { HospitalOperationSlot } from '../entities/hospital-operation-slot.entity';
import { SurgicalOperation } from '../entities/surgical-operation.entity';
import { SurgeryReservation } from '../entities/surgery-reservation.entity';
import { Doctor } from '../entities/doctor.entity';
import { DoctorSpeciality } from '../entities/doctor-speciality.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Hospital,
      HospitalDoctor,
      HospitalSlotOverride,
      User,
      HospitalOperationSlot,
      SurgicalOperation,
      SurgeryReservation,
      Doctor,
      DoctorSpeciality,
    ]),
    PushNotificationsModule,
    MailModule,
  ],
  controllers: [HospitalsController],
  providers: [HospitalsService],
})
export class HospitalsModule {}
