import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { ILike, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Hospital } from '../entities/hospital.entity';
import { HospitalDoctor } from '../entities/hospital-doctor.entity';
import { HospitalOperationSlot } from '../entities/hospital-operation-slot.entity';
import { HospitalSlotOverride } from '../entities/hospital-slot-override.entity';
import { SurgicalOperation } from '../entities/surgical-operation.entity';
import {
  ACTIVE_RESERVATION_STATUSES,
  SurgeryReservation,
} from '../entities/surgery-reservation.entity';
import { Doctor } from '../entities/doctor.entity';
import { DoctorSpeciality } from '../entities/doctor-speciality.entity';
import { User, UserRole } from '../entities/user.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { MailService } from '../mail/mail.service';
import {
  DATE_RE,
  isFutureSlot,
  localDateYmd,
  minutesToTime,
  normalizeTime,
  timeToMinutes,
} from '../schedules/schedules.service';
import { MAX_SLOT_MINUTES, MIN_SLOT_MINUTES } from '../schedules/schedule.constants';
import {
  AdminHospitalDto,
  CreateHospitalDto,
  CreateSurgeryReservationDto,
  CreateSurgicalOperationDto,
  HospitalOverrideInput,
  HospitalSlotInput,
  UpdateHospitalDto,
  UpdateSurgicalOperationDto,
} from './dto/hospital.dto';

/** Public doctor fields — never leak bank/national-id columns. */
const PUBLIC_DOCTOR_SELECT = {
  id: true,
  name: true,
  photo_url: true,
  professional_title: true,
  speciality_id: true,
} as const;

/** App routes a surgery notification may open (mobile allowlists the same set). */
const PATH = {
  patient: '/(tabs)/reservations',
  doctor: '/(tabs)/surgeries',
  hospital: '/hospital',
} as const;

/** Initial password for hospital accounts created by an admin. */
export const DEFAULT_HOSPITAL_PASSWORD = 'Aa123456';

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === '23505';
}

function validSlotMinutes(n: number) {
  return Number.isInteger(n) && n >= MIN_SLOT_MINUTES && n <= MAX_SLOT_MINUTES;
}

@Injectable()
export class HospitalsService {
  private readonly logger = new Logger(HospitalsService.name);

  constructor(
    @InjectRepository(Hospital) private hospitalRepo: Repository<Hospital>,
    @InjectRepository(HospitalDoctor) private linkRepo: Repository<HospitalDoctor>,
    @InjectRepository(HospitalOperationSlot)
    private slotRepo: Repository<HospitalOperationSlot>,
    @InjectRepository(HospitalSlotOverride)
    private overrideRepo: Repository<HospitalSlotOverride>,
    @InjectRepository(SurgicalOperation)
    private operationRepo: Repository<SurgicalOperation>,
    @InjectRepository(SurgeryReservation)
    private reservationRepo: Repository<SurgeryReservation>,
    @InjectRepository(Doctor) private doctorRepo: Repository<Doctor>,
    @InjectRepository(DoctorSpeciality)
    private specialityRepo: Repository<DoctorSpeciality>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private readonly push: PushNotificationsService,
    private readonly mail: MailService,
  ) {}

  // ── Notifications (push + in-app + email), never blocking the request ──
  private notify(
    userId: string | null | undefined,
    title: string,
    body: string,
    path: string,
    data: Record<string, string> = {},
  ) {
    if (!userId) return;
    void this.push
      .sendSystemNotification(
        { recipientId: userId, title, body, data: { type: 'surgery', path, ...data } },
        { alwaysPush: true },
      )
      .catch((e) => this.logger.warn(`push to ${userId} failed: ${(e as Error).message}`));
    void this.userRepo
      .findOne({ where: { id: userId }, select: { id: true, email: true } })
      .then((u) =>
        u?.email
          ? this.mail.sendMail({
              to: u.email,
              subject: title,
              text: `${body}\n\nOpen the 3elagi app to see the details.`,
            })
          : undefined,
      )
      .catch((e) => this.logger.warn(`email to ${userId} failed: ${(e as Error).message}`));
  }

  // ── Surgical operations catalog ─────────────────────────────────────
  listOperations(specialityId?: string, includeInactive = false) {
    return this.operationRepo.find({
      where: {
        ...(specialityId ? { speciality_id: specialityId } : {}),
        ...(includeInactive ? {} : { is_active: true }),
      },
      relations: ['speciality'],
      order: { name_en: 'ASC' },
    });
  }

  private async assertSpeciality(id: string) {
    if (!(await this.specialityRepo.exist({ where: { id } }))) {
      throw new BadRequestException('Unknown speciality');
    }
  }

  async createOperation(dto: CreateSurgicalOperationDto) {
    await this.assertSpeciality(dto.speciality_id);
    return this.operationRepo.save(
      this.operationRepo.create({
        name_en: dto.name_en.trim(),
        name_ar: dto.name_ar.trim(),
        speciality_id: dto.speciality_id,
        is_active: dto.is_active !== false,
      }),
    );
  }

  async updateOperation(id: string, dto: UpdateSurgicalOperationDto) {
    const op = await this.operationRepo.findOne({ where: { id } });
    if (!op) throw new NotFoundException('Operation not found');
    if (dto.speciality_id) await this.assertSpeciality(dto.speciality_id);
    Object.assign(op, {
      ...(dto.name_en !== undefined ? { name_en: dto.name_en.trim() } : {}),
      ...(dto.name_ar !== undefined ? { name_ar: dto.name_ar.trim() } : {}),
      ...(dto.speciality_id ? { speciality_id: dto.speciality_id } : {}),
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
    });
    return this.operationRepo.save(op);
  }

  async deleteOperation(id: string) {
    const res = await this.operationRepo.delete({ id });
    if (!res.affected) throw new NotFoundException('Operation not found');
    return { ok: true };
  }

  // ── Hospitals (admin) ───────────────────────────────────────────────
  /** Includes the owner account's email only — never the rest of the user row. */
  listHospitalsAdmin() {
    return this.hospitalRepo
      .createQueryBuilder('h')
      .leftJoin('h.owner', 'u')
      .addSelect(['u.id', 'u.email'])
      .orderBy('h.created_at', 'DESC')
      .getMany();
  }

  async createHospital(dto: CreateHospitalDto) {
    const email = dto.email?.trim().toLowerCase();
    if (email && (await this.userRepo.exist({ where: { email } }))) {
      throw new ConflictException('Email already in use');
    }
    // ponytail: shared default password; the hospital changes it via change-password.
    const passwordHash = email ? await bcrypt.hash(DEFAULT_HOSPITAL_PASSWORD, 10) : null;
    const saved = await this.hospitalRepo.manager.transaction(async (m) => {
      const owner = email
        ? await m.save(
            m.create(User, {
              email,
              password_hash: passwordHash,
              role: UserRole.HOSPITAL,
              preferred_locale: 'ar',
              email_verified_at: new Date(),
            }),
          )
        : null;
      return m.save(
        m.create(Hospital, {
          name: dto.name.trim(),
          location: dto.location?.trim() ?? '',
          description: dto.description?.trim() ?? '',
          phone: dto.phone?.trim() ?? '',
          is_active: dto.is_active !== false,
          approval_status: 'approved',
          owner_id: owner?.id ?? null,
        }),
      );
    });
    return {
      ...saved,
      owner: email ? { id: saved.owner_id, email } : null,
      default_password: email ? DEFAULT_HOSPITAL_PASSWORD : null,
    };
  }

  async updateHospital(id: string, dto: AdminHospitalDto) {
    const hospital = await this.hospitalRepo.findOne({ where: { id } });
    if (!hospital) throw new NotFoundException('Hospital not found');
    const before = hospital.approval_status;
    const saved = await this.applyHospitalFields(hospital, dto);
    if (dto.approval_status && dto.approval_status !== before && dto.approval_status !== 'pending') {
      const approved = dto.approval_status === 'approved';
      this.notify(
        saved.owner_id,
        approved ? 'Your hospital is approved' : 'Your hospital registration was rejected',
        approved
          ? `${saved.name} is now visible to patients on 3elagi.`
          : `${saved.name} was not approved. Contact 3elagi support for details.`,
        PATH.hospital,
      );
    }
    return saved;
  }

  async deleteHospital(id: string) {
    const res = await this.hospitalRepo.delete({ id });
    if (!res.affected) throw new NotFoundException('Hospital not found');
    return { ok: true };
  }

  private applyHospitalFields(hospital: Hospital, dto: AdminHospitalDto) {
    if (dto.name !== undefined) hospital.name = dto.name.trim();
    if (dto.location !== undefined) hospital.location = dto.location.trim();
    if (dto.description !== undefined) hospital.description = dto.description.trim();
    if (dto.phone !== undefined) hospital.phone = dto.phone.trim();
    if (dto.is_active !== undefined) hospital.is_active = dto.is_active;
    if (dto.approval_status !== undefined) hospital.approval_status = dto.approval_status;
    return this.hospitalRepo.save(hospital);
  }

  // ── Public browse ───────────────────────────────────────────────────
  async listHospitals(operationId?: string) {
    const qb = this.hospitalRepo
      .createQueryBuilder('h')
      .select(['h.id', 'h.name', 'h.location', 'h.description', 'h.phone'])
      .where(`h.is_active = true AND h.approval_status = 'approved'`)
      .orderBy('h.name', 'ASC');
    if (operationId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM hospital_operation_slots s
                 WHERE s.hospital_id = h.id AND s.operation_id = :operationId)`,
        { operationId },
      );
    }
    return qb.getMany();
  }

  /** Approved doctors with an approved link to the hospital; filtered to the operation's speciality. */
  async hospitalDoctors(hospitalId: string, operationId?: string) {
    const qb = this.doctorRepo
      .createQueryBuilder('d')
      .innerJoin('hospital_doctors', 'hd', `hd.doctor_id = d.id AND hd.status = 'approved'`)
      .leftJoinAndSelect('d.speciality', 'sp')
      .select([
        'd.id',
        'd.name',
        'd.photo_url',
        'd.professional_title',
        'sp.id',
        'sp.name_en',
        'sp.name_ar',
      ])
      .where('hd.hospital_id = :hospitalId', { hospitalId })
      .andWhere(`d.approval_status = 'approved'`)
      .orderBy('d.name', 'ASC');
    if (operationId) {
      const op = await this.operationRepo.findOne({ where: { id: operationId } });
      if (!op) throw new NotFoundException('Operation not found');
      qb.andWhere(
        `(d.speciality_id = :sid OR EXISTS (
            SELECT 1 FROM doctor_speciality_links l
            WHERE l.doctor_id = d.id AND l.speciality_id = :sid))`,
        { sid: op.speciality_id },
      );
    }
    return qb.getMany();
  }

  /** Date overrides win over the weekly windows (same rule as doctor schedules). */
  private async slotTimes(
    hospitalId: string,
    operationId: string,
    dateStr: string,
  ): Promise<string[]> {
    const overrides = await this.overrideRepo.find({
      where: [operationId, null].map((op) => ({
        hospital_id: hospitalId,
        operation_id: op === null ? IsNull() : op,
        start_date: LessThanOrEqual(dateStr),
        end_date: MoreThanOrEqual(dateStr),
      })),
    });
    let windows: { start_time: string; end_time: string; slot_minutes: number }[];
    if (overrides.length > 0) {
      if (overrides.some((o) => o.is_closed)) return [];
      windows = overrides.filter((o) => o.start_time && o.end_time && o.slot_minutes) as typeof windows;
    } else {
      const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
      windows = await this.slotRepo.find({
        where: { hospital_id: hospitalId, operation_id: operationId, day_of_week: day },
      });
    }
    const set = new Set<string>();
    for (const w of windows) {
      const end = timeToMinutes(w.end_time);
      for (let t = timeToMinutes(w.start_time); t + w.slot_minutes <= end; t += w.slot_minutes) {
        set.add(minutesToTime(t));
      }
    }
    let slots = Array.from(set).sort();
    if (dateStr <= localDateYmd()) {
      const now = new Date();
      slots = slots.filter((time) => isFutureSlot(dateStr, time, now));
    }
    return slots;
  }

  async availableSlots(hospitalId: string, operationId: string, dateStr: string) {
    if (!DATE_RE.test(dateStr ?? '')) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const slots = await this.slotTimes(hospitalId, operationId, dateStr);
    const live = await this.reservationRepo.find({
      where: {
        hospital_id: hospitalId,
        operation_id: operationId,
        date: dateStr,
        status: In(ACTIVE_RESERVATION_STATUSES),
      },
    });
    const taken = new Map(live.map((r) => [r.time.slice(0, 5), r.status]));
    return slots.map((time) => ({
      time,
      taken: taken.has(time),
      status: taken.get(time) ?? null,
    }));
  }

  // ── Hospital account (self-service) ─────────────────────────────────
  private async mine(userId: string): Promise<Hospital> {
    const hospital = await this.hospitalRepo.findOne({ where: { owner_id: userId } });
    if (!hospital) throw new ForbiddenException('Hospital profile not found');
    return hospital;
  }

  private links(by: { hospital_id: string } | { doctor_id: string }) {
    const [column, id] = Object.entries(by)[0];
    return this.linkRepo
      .createQueryBuilder('l')
      .leftJoin('l.doctor', 'd')
      .leftJoin('d.speciality', 'sp')
      .leftJoin('l.hospital', 'h')
      .select([
        'l.hospital_id',
        'l.doctor_id',
        'l.status',
        'l.created_at',
        'd.id',
        'd.name',
        'd.photo_url',
        'sp.id',
        'sp.name_en',
        'sp.name_ar',
        'h.id',
        'h.name',
        'h.location',
      ])
      .where(`l.${column} = :id`, { id })
      .orderBy('l.created_at', 'DESC')
      .getMany();
  }

  async getMine(userId: string) {
    const hospital = await this.mine(userId);
    const [links, slots, overrides] = await Promise.all([
      this.links({ hospital_id: hospital.id }),
      this.slotRepo.find({
        where: { hospital_id: hospital.id },
        relations: ['operation'],
        order: { day_of_week: 'ASC', start_time: 'ASC' },
      }),
      this.overrideRepo.find({
        where: { hospital_id: hospital.id },
        order: { start_date: 'ASC' },
      }),
    ]);
    return { ...hospital, links, slots, overrides };
  }

  async updateMine(userId: string, dto: UpdateHospitalDto) {
    const hospital = await this.mine(userId);
    // is_active / approval_status stay admin-only.
    return this.applyHospitalFields(hospital, {
      name: dto.name,
      location: dto.location,
      description: dto.description,
      phone: dto.phone,
    });
  }

  searchDoctors(q: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    return this.doctorRepo.find({
      select: PUBLIC_DOCTOR_SELECT,
      where: { name: ILike(`%${term.replace(/[%_]/g, '')}%`), approval_status: 'approved' },
      order: { name: 'ASC' },
      take: 20,
    });
  }

  /** Invite (or re-invite after a rejection) — the doctor must confirm. */
  async inviteDoctor(userId: string, doctorId: string) {
    const hospital = await this.mine(userId);
    const doctor = await this.doctorRepo.findOne({
      where: { id: doctorId, approval_status: 'approved' },
    });
    if (!doctor) throw new BadRequestException('Doctor is unknown or not approved');
    const existing = await this.linkRepo.findOne({
      where: { hospital_id: hospital.id, doctor_id: doctorId },
    });
    if (existing?.status === 'approved') return existing;
    if (existing?.status === 'pending') return existing;
    const link = await this.linkRepo.save(
      this.linkRepo.create({ hospital_id: hospital.id, doctor_id: doctorId, status: 'pending' }),
    );
    this.notify(
      doctor.user_id,
      'Hospital invitation',
      `${hospital.name} wants to add you as a surgeon. Open Surgeries to accept or decline.`,
      PATH.doctor,
    );
    return link;
  }

  async removeDoctor(userId: string, doctorId: string) {
    const hospital = await this.mine(userId);
    await this.linkRepo.delete({ hospital_id: hospital.id, doctor_id: doctorId });
    return { ok: true };
  }

  async replaceMySlots(userId: string, items: HospitalSlotInput[]) {
    const hospital = await this.mine(userId);
    await this.assertActiveOperations(items.map((i) => i.operation_id));
    const rows = items.map((i, idx) => {
      if (i.day_of_week < 0 || i.day_of_week > 6) {
        throw new BadRequestException(`row ${idx}: day_of_week must be 0–6`);
      }
      if (timeToMinutes(i.end_time) <= timeToMinutes(i.start_time)) {
        throw new BadRequestException(`row ${idx}: end_time must be after start_time`);
      }
      if (!validSlotMinutes(i.slot_minutes)) {
        throw new BadRequestException(
          `row ${idx}: slot_minutes must be ${MIN_SLOT_MINUTES}–${MAX_SLOT_MINUTES}`,
        );
      }
      return this.slotRepo.create({
        hospital_id: hospital.id,
        operation_id: i.operation_id,
        day_of_week: i.day_of_week,
        start_time: normalizeTime(i.start_time),
        end_time: normalizeTime(i.end_time),
        slot_minutes: i.slot_minutes,
      });
    });
    // ponytail: replace-all like doctor schedules; existing reservations are kept as-is.
    await this.slotRepo.delete({ hospital_id: hospital.id });
    if (rows.length) await this.slotRepo.save(rows);
    return (await this.getMine(userId)).slots;
  }

  async replaceMyOverrides(userId: string, items: HospitalOverrideInput[]) {
    const hospital = await this.mine(userId);
    await this.assertActiveOperations(
      items.map((i) => i.operation_id).filter((id): id is string => !!id),
    );
    const rows = items.map((i, idx) => {
      if (i.end_date < i.start_date) {
        throw new BadRequestException(`row ${idx}: end_date must be ≥ start_date`);
      }
      const open = !i.is_closed;
      if (open) {
        if (!i.start_time || !i.end_time || timeToMinutes(i.end_time) <= timeToMinutes(i.start_time)) {
          throw new BadRequestException(`row ${idx}: open days need start/end time, end after start`);
        }
        if (!validSlotMinutes(Number(i.slot_minutes))) {
          throw new BadRequestException(
            `row ${idx}: slot_minutes must be ${MIN_SLOT_MINUTES}–${MAX_SLOT_MINUTES}`,
          );
        }
      }
      return this.overrideRepo.create({
        hospital_id: hospital.id,
        operation_id: i.operation_id || null,
        start_date: i.start_date,
        end_date: i.end_date,
        is_closed: !open,
        start_time: open ? normalizeTime(i.start_time!) : null,
        end_time: open ? normalizeTime(i.end_time!) : null,
        slot_minutes: open ? Number(i.slot_minutes) : null,
        note: i.note?.trim() || null,
      });
    });
    await this.overrideRepo.delete({ hospital_id: hospital.id });
    if (rows.length) await this.overrideRepo.save(rows);
    return this.overrideRepo.find({ where: { hospital_id: hospital.id }, order: { start_date: 'ASC' } });
  }

  private async assertActiveOperations(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const count = await this.operationRepo.count({ where: { id: In(unique), is_active: true } });
    if (count !== unique.length) {
      throw new BadRequestException('Unknown or inactive surgical operation');
    }
  }

  private reservationQuery() {
    return this.reservationRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.operation', 'op')
      .leftJoin('r.hospital', 'h')
      .addSelect(['h.id', 'h.name', 'h.location', 'h.phone', 'h.owner_id'])
      .leftJoin('r.doctor', 'd')
      .addSelect(['d.id', 'd.name', 'd.photo_url', 'd.user_id'])
      .orderBy('r.date', 'DESC')
      .addOrderBy('r.time', 'DESC');
  }

  /** Reservations plus the patient's name/phone (for hospital and doctor views). */
  private async withPatient(qb: ReturnType<HospitalsService['reservationQuery']>) {
    const { entities, raw } = await qb
      .leftJoin('patient_profiles', 'pp', 'pp.user_id = r.patient_user_id')
      .addSelect('pp.name', 'patient_name')
      .addSelect('pp.phone', 'patient_phone')
      .getRawAndEntities();
    return entities.map((e) => {
      const row = raw.find((x) => x.r_id === e.id);
      return {
        ...e,
        patient_name: row?.patient_name ?? null,
        patient_phone: row?.patient_phone ?? null,
      };
    });
  }

  async myHospitalReservations(userId: string) {
    const hospital = await this.mine(userId);
    return this.withPatient(this.reservationQuery().where('r.hospital_id = :id', { id: hospital.id }));
  }

  private loadReservation(id: string) {
    return this.reservationQuery().where('r.id = :id', { id }).getOne();
  }

  private async patientName(userId: string) {
    const rows = await this.reservationRepo.query(
      `SELECT name FROM patient_profiles WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return (rows[0]?.name as string) || 'A patient';
  }

  async decide(userId: string, id: string, status: 'approved' | 'rejected') {
    const hospital = await this.mine(userId);
    const r = await this.reservationRepo.findOne({ where: { id, hospital_id: hospital.id } });
    if (!r) throw new NotFoundException('Reservation not found');
    if (r.status !== 'pending') {
      throw new BadRequestException(`Reservation is already ${r.status}`);
    }
    r.status = status;
    await this.reservationRepo.save(r);

    const full = await this.loadReservation(r.id);
    const what = `${full.operation?.name_en ?? 'surgery'} at ${hospital.name} on ${r.date} ${r.time.slice(0, 5)}`;
    const verb = status === 'approved' ? 'approved' : 'rejected';
    this.notify(
      r.patient_user_id,
      `Surgery reservation ${verb}`,
      `Your ${what} was ${verb}.`,
      PATH.patient,
      { reservationId: r.id },
    );
    this.notify(
      full.doctor?.user_id,
      `Surgery reservation ${verb}`,
      `${await this.patientName(r.patient_user_id)}'s ${what} was ${verb} by the hospital.`,
      PATH.doctor,
      { reservationId: r.id },
    );
    return full;
  }

  // ── Doctor ──────────────────────────────────────────────────────────
  private async myDoctor(userId: string) {
    const doctor = await this.doctorRepo.findOne({ where: { user_id: userId } });
    if (!doctor) throw new ForbiddenException('Doctor profile not found');
    return doctor;
  }

  async doctorLinks(userId: string) {
    return this.links({ doctor_id: (await this.myDoctor(userId)).id });
  }

  async respondLink(userId: string, hospitalId: string, status: 'approved' | 'rejected') {
    const doctor = await this.myDoctor(userId);
    const link = await this.linkRepo.findOne({
      where: { hospital_id: hospitalId, doctor_id: doctor.id },
      relations: ['hospital'],
    });
    if (!link) throw new NotFoundException('Invitation not found');
    link.status = status;
    await this.linkRepo.save(link);
    this.notify(
      link.hospital?.owner_id,
      status === 'approved' ? 'Doctor joined your hospital' : 'Doctor declined your invitation',
      `Dr. ${doctor.name} ${status === 'approved' ? 'accepted' : 'declined'} the invitation to ${link.hospital?.name}.`,
      PATH.hospital,
    );
    return { hospital_id: link.hospital_id, doctor_id: link.doctor_id, status: link.status };
  }

  async doctorReservations(userId: string) {
    const doctor = await this.myDoctor(userId);
    return this.withPatient(this.reservationQuery().where('r.doctor_id = :id', { id: doctor.id }));
  }

  // ── Patient reservations ────────────────────────────────────────────
  async reserve(userId: string, dto: CreateSurgeryReservationDto) {
    const hospital = await this.hospitalRepo.findOne({
      where: { id: dto.hospital_id, is_active: true, approval_status: 'approved' },
    });
    if (!hospital) throw new NotFoundException('Hospital not found');
    const doctors = await this.hospitalDoctors(hospital.id, dto.operation_id);
    if (!doctors.some((d) => d.id === dto.doctor_id)) {
      throw new BadRequestException('Doctor is not available for this operation at this hospital');
    }
    const time = dto.time.slice(0, 5);
    const slot = (await this.availableSlots(hospital.id, dto.operation_id, dto.date)).find(
      (s) => s.time === time,
    );
    if (!slot) throw new BadRequestException('Slot is not available');
    if (slot.taken) throw new ConflictException('Slot is already reserved');
    let saved: SurgeryReservation;
    try {
      saved = await this.reservationRepo.save(
        this.reservationRepo.create({
          hospital_id: hospital.id,
          operation_id: dto.operation_id,
          doctor_id: dto.doctor_id,
          patient_user_id: userId,
          date: dto.date,
          time: normalizeTime(time),
          status: 'pending',
          notes: dto.notes?.trim() || null,
        }),
      );
    } catch (e) {
      // Partial unique indexes catch the race between two patients / the doctor's other slot.
      if (isUniqueViolation(e)) {
        throw new ConflictException('Slot or doctor is already reserved at this time');
      }
      throw e;
    }

    const full = await this.loadReservation(saved.id);
    const patient = await this.patientName(userId);
    const what = `${full.operation?.name_en ?? 'surgery'} on ${dto.date} ${time} with Dr. ${full.doctor?.name ?? ''}`.trim();
    this.notify(
      hospital.owner_id,
      'New surgery reservation',
      `${patient} requested ${what}. Approve or reject it in your dashboard.`,
      PATH.hospital,
      { reservationId: saved.id },
    );
    this.notify(
      full.doctor?.user_id,
      'New surgery reservation',
      `${patient} booked ${full.operation?.name_en ?? 'surgery'} at ${hospital.name} on ${dto.date} ${time} (awaiting hospital approval).`,
      PATH.doctor,
      { reservationId: saved.id },
    );
    return full;
  }

  myPatientReservations(userId: string) {
    return this.reservationQuery()
      .where('r.patient_user_id = :userId', { userId })
      .getMany();
  }

  async cancel(userId: string, id: string) {
    const r = await this.reservationRepo.findOne({ where: { id, patient_user_id: userId } });
    if (!r) throw new NotFoundException('Reservation not found');
    if (!ACTIVE_RESERVATION_STATUSES.includes(r.status)) {
      throw new BadRequestException(`Reservation is already ${r.status}`);
    }
    r.status = 'cancelled';
    return this.reservationRepo.save(r);
  }
}
