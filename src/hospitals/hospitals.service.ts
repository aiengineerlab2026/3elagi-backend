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
import { Between, In, IsNull, Repository } from 'typeorm';
import { Hospital } from '../entities/hospital.entity';
import { HospitalDoctor } from '../entities/hospital-doctor.entity';
import { HospitalSurgery } from '../entities/hospital-surgery.entity';
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
  CreateHospitalOperationDto,
  CreateSurgeryReservationDto,
  CreateSurgicalOperationDto,
  HospitalOverrideInput,
  HospitalSlotInput,
  UpdateHospitalDto,
  UpdateSurgicalOperationDto,
} from './dto/hospital.dto';

/** Public doctor columns — never leak bank/national-id fields. */
const PUBLIC_DOCTOR_COLUMNS = [
  'd.id',
  'd.name',
  'd.photo_url',
  'd.professional_title',
  'sp.id',
  'sp.name_en',
  'sp.name_ar',
];

const MAX_AVAILABILITY_DAYS = 31;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type SlotWindow = { start_time: string; end_time: string; slot_minutes: number };

/** Slot start times for one day; date overrides win over weekly windows. */
export function slotTimesForDay(
  date: string,
  weekly: (SlotWindow & { day_of_week: number; date?: string | null })[],
  overrides: (Partial<SlotWindow> & { start_date: string; end_date: string; is_closed: boolean })[],
): string[] {
  const today = overrides.filter((o) => o.start_date <= date && o.end_date >= date);
  if (today.some((o) => o.is_closed)) return [];
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  // Open exceptions replace the repeating windows; one-off dated windows always add on.
  const base: Partial<SlotWindow>[] =
    today.length > 0 ? today : weekly.filter((w) => !w.date && w.day_of_week === dow);
  const windows = [...base, ...weekly.filter((w) => w.date === date)];
  const set = new Set<string>();
  for (const w of windows) {
    if (!w.start_time || !w.end_time || !w.slot_minutes) continue;
    const end = timeToMinutes(w.end_time);
    for (let t = timeToMinutes(w.start_time); t + w.slot_minutes <= end; t += w.slot_minutes) {
      set.add(minutesToTime(t));
    }
  }
  return Array.from(set).sort();
}

/** App routes a surgery notification may open (mobile allowlists the same set). */
const PATH = {
  patient: '/(tabs)/reservations',
  doctor: '/(tabs)/surgeries',
  hospital: '/hospital/availability',
  hospitalReservations: '/hospital',
  hospitalDoctors: '/hospital/doctors',
  doctorHospitals: '/(tabs)/hospitals',
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
    @InjectRepository(HospitalSurgery) private surgeryRepo: Repository<HospitalSurgery>,
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
  /**
   * Public: the catalog plus hospital-custom surgeries that some hospital offers.
   * Admin (includeInactive): everything, with the hospital behind custom ones.
   */
  listOperations(specialityId?: string, includeInactive = false) {
    const qb = this.operationRepo
      .createQueryBuilder('op')
      .leftJoinAndSelect('op.speciality', 'sp')
      .orderBy('op.name_en', 'ASC');
    if (specialityId) qb.andWhere('op.speciality_id = :specialityId', { specialityId });
    if (includeInactive) {
      qb.leftJoin('op.hospital', 'h').addSelect(['h.id', 'h.name']);
    } else {
      qb.andWhere('op.is_active = true').andWhere(
        `(op.hospital_id IS NULL OR EXISTS (
            SELECT 1 FROM hospital_surgeries hs WHERE hs.operation_id = op.id))`,
      );
    }
    return qb.getMany();
  }

  /** What a hospital can pick from: the active catalog plus its own custom surgeries. */
  async hospitalOperations(userId: string) {
    const hospital = await this.mine(userId);
    return this.operationRepo
      .createQueryBuilder('op')
      .leftJoinAndSelect('op.speciality', 'sp')
      .where('op.is_active = true')
      .andWhere('(op.hospital_id IS NULL OR op.hospital_id = :hid)', { hid: hospital.id })
      .orderBy('op.name_en', 'ASC')
      .getMany();
  }

  /** Hospital adds a surgery missing from the catalog; reuses an existing one with the same name. */
  async createHospitalOperation(userId: string, dto: CreateHospitalOperationDto) {
    const hospital = await this.mine(userId);
    await this.assertSpeciality(dto.speciality_id);
    const nameEn = dto.name_en.trim();
    const existing = await this.operationRepo
      .createQueryBuilder('op')
      .leftJoinAndSelect('op.speciality', 'sp')
      .where('op.speciality_id = :sid', { sid: dto.speciality_id })
      .andWhere('LOWER(op.name_en) = LOWER(:name)', { name: nameEn })
      .andWhere('(op.hospital_id IS NULL OR op.hospital_id = :hid)', { hid: hospital.id })
      .andWhere('op.is_active = true')
      .getOne();
    if (existing) return existing;
    const saved = await this.operationRepo.save(
      this.operationRepo.create({
        name_en: nameEn,
        // English only for custom surgeries; name_ar is required, so it mirrors the English name.
        name_ar: nameEn,
        speciality_id: dto.speciality_id,
        hospital_id: hospital.id,
        is_active: true,
      }),
    );
    return this.operationRepo.findOne({ where: { id: saved.id }, relations: ['speciality'] });
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
        PATH.hospitalReservations,
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
                 WHERE s.hospital_id = h.id AND s.operation_id = :operationId
                   AND s.status = 'approved')`,
        { operationId },
      );
    }
    return qb.getMany();
  }

  /**
   * Approved doctors with an approved link to the hospital. With an operation,
   * only doctors the hospital gave slots for that operation.
   */
  async hospitalDoctors(hospitalId: string, operationId?: string) {
    const qb = this.doctorRepo
      .createQueryBuilder('d')
      .innerJoin('hospital_doctors', 'hd', `hd.doctor_id = d.id AND hd.status = 'approved'`)
      .leftJoin('d.speciality', 'sp')
      .select(PUBLIC_DOCTOR_COLUMNS)
      .where('hd.hospital_id = :hospitalId', { hospitalId })
      .andWhere(`d.approval_status = 'approved'`)
      .orderBy('d.name', 'ASC');
    if (operationId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM hospital_operation_slots s
                 WHERE s.hospital_id = :hospitalId AND s.operation_id = :operationId
                   AND s.doctor_id = d.id AND s.status = 'approved')`,
        { operationId },
      );
    }
    return qb.getMany();
  }

  /**
   * Free/taken slots per day for one doctor doing one operation at a hospital.
   * A slot is taken when the doctor has any live reservation at that time
   * (at any hospital) — a doctor can't be in two operating rooms at once.
   */
  async availability(
    hospitalId: string,
    operationId: string,
    doctorId: string,
    from?: string,
    days = 14,
  ) {
    if (from && !DATE_RE.test(from)) throw new BadRequestException('from must be YYYY-MM-DD');
    const today = localDateYmd();
    const start = from && from > today ? from : today;
    const count = Math.min(Math.max(Math.floor(Number(days)) || 14, 1), MAX_AVAILABILITY_DAYS);
    const dates = Array.from({ length: count }, (_, i) => addDays(start, i));
    const end = dates[dates.length - 1];
    const [weekly, overrides, live] = await Promise.all([
      this.slotRepo.find({
        where: {
          hospital_id: hospitalId,
          operation_id: operationId,
          doctor_id: doctorId,
          status: 'approved',
        },
      }),
      this.overrideRepo
        .createQueryBuilder('o')
        .where('o.hospital_id = :hospitalId', { hospitalId })
        .andWhere('(o.operation_id IS NULL OR o.operation_id = :operationId)', { operationId })
        .andWhere('(o.doctor_id IS NULL OR o.doctor_id = :doctorId)', { doctorId })
        .andWhere('o.start_date <= :end AND o.end_date >= :start', { start, end })
        .getMany(),
      this.reservationRepo.find({
        where: {
          doctor_id: doctorId,
          date: Between(start, end),
          status: In(ACTIVE_RESERVATION_STATUSES),
        },
      }),
    ]);
    const now = new Date();
    return dates.map((date) => {
      let times = slotTimesForDay(date, weekly, overrides);
      if (date === today) times = times.filter((t) => isFutureSlot(date, t, now));
      const taken = new Set(live.filter((r) => r.date === date).map((r) => r.time.slice(0, 5)));
      return { date, slots: times.map((time) => ({ time, taken: taken.has(time) })) };
    });
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
      .leftJoin('d.specialities', 'ds')
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
        'ds.id',
        'ds.name_en',
        'ds.name_ar',
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
    const [links, slots, overrides, surgeries] = await Promise.all([
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
      this.surgeriesOf(hospital.id),
    ]);
    return { ...hospital, links, slots, overrides, surgeries };
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

  /**
   * Autocomplete for the hospital's "add doctor" input. A term with "@" matches
   * the doctor's email (and returns it — the hospital already knows it);
   * anything else matches the name only, so emails can't be probed or harvested.
   */
  async searchDoctors(q: string) {
    const term = (q ?? '').trim().replace(/[%_\\]/g, '');
    if (term.length < 1) return [];
    const byEmail = term.includes('@');
    const doctors = await this.doctorRepo
      .createQueryBuilder('d')
      .leftJoin('d.speciality', 'sp')
      .leftJoin('d.user', 'u')
      .select([...PUBLIC_DOCTOR_COLUMNS, 'u.id', 'u.email'])
      .where(byEmail ? 'u.email ILIKE :q' : 'd.name ILIKE :q', {
        q: `%${term}%`,
      })
      .andWhere(`d.approval_status = 'approved'`)
      .orderBy('d.name', 'ASC')
      .take(10)
      .getMany();
    return doctors.map(({ user, ...d }) => ({ ...d, email: byEmail ? user?.email ?? null : null }));
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
      `${hospital.name} wants to add you as a surgeon. Open Hospitals to accept or decline.`,
      PATH.doctorHospitals,
    );
    return link;
  }

  async removeDoctor(userId: string, doctorId: string) {
    const hospital = await this.mine(userId);
    await this.linkRepo.delete({ hospital_id: hospital.id, doctor_id: doctorId });
    await this.slotRepo.delete({ hospital_id: hospital.id, doctor_id: doctorId });
    await this.unassignDoctor(hospital.id, doctorId);
    return { ok: true };
  }

  /** Validates windows and builds rows; doctors must be linked and practise each operation. */
  private async buildSlotRows(
    hospitalId: string,
    items: HospitalSlotInput[],
    status: 'approved' | 'pending',
    createdBy: 'hospital' | 'doctor',
  ) {
    await this.assertActiveOperations(items.map((i) => i.operation_id));
    await this.assertBookableDoctors(hospitalId, items);
    const today = localDateYmd();
    return items.map((i, idx) => {
      if (i.date && i.date < today) {
        throw new BadRequestException(`row ${idx}: date is in the past`);
      }
      const dayOfWeek = i.date ? new Date(`${i.date}T00:00:00Z`).getUTCDay() : i.day_of_week;
      if (dayOfWeek === undefined || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new BadRequestException(`row ${idx}: needs a date or day_of_week 0–6`);
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
        hospital_id: hospitalId,
        operation_id: i.operation_id,
        doctor_id: i.doctor_id,
        day_of_week: dayOfWeek,
        date: i.date ?? null,
        start_time: normalizeTime(i.start_time),
        end_time: normalizeTime(i.end_time),
        slot_minutes: i.slot_minutes,
        status,
        created_by: createdBy,
      });
    });
  }

  /** Hospital editor: replaces the approved windows; doctors' pending proposals are untouched. */
  async replaceMySlots(userId: string, items: HospitalSlotInput[]) {
    const hospital = await this.mine(userId);
    const rows = await this.buildSlotRows(hospital.id, items, 'approved', 'hospital');
    // ponytail: replace-all like doctor schedules; existing reservations are kept as-is.
    await this.slotRepo.delete({ hospital_id: hospital.id, status: 'approved', date: IsNull() });
    if (rows.length) await this.slotRepo.save(rows);
    return (await this.getMine(userId)).slots;
  }

  /**
   * Approve/reject doctor proposals in one go (a calendar proposal is one row per
   * date). Approved windows can also be revoked by rejecting them.
   */
  async decideSlots(userId: string, ids: string[], status: 'approved' | 'rejected') {
    const hospital = await this.mine(userId);
    const slots = ids.length
      ? await this.slotRepo.find({
          where: { id: In([...new Set(ids)]), hospital_id: hospital.id },
          relations: ['operation', 'doctor'],
        })
      : [];
    if (slots.length !== new Set(ids).size) throw new NotFoundException('Slot not found');
    for (const slot of slots) {
      const allowed = slot.status === 'pending' || (slot.status === 'approved' && status === 'rejected');
      if (!allowed) throw new BadRequestException(`Slot is already ${slot.status}`);
      slot.status = status;
    }
    await this.slotRepo.save(slots);

    const verb = status === 'approved' ? 'approved' : 'rejected';
    const byDoctor = new Map<string, HospitalOperationSlot[]>();
    for (const slot of slots) {
      byDoctor.set(slot.doctor_id, [...(byDoctor.get(slot.doctor_id) ?? []), slot]);
    }
    for (const rows of byDoctor.values()) {
      const dates = rows.map((r) => r.date ?? `every ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.day_of_week]}`);
      this.notify(
        rows[0].doctor?.user_id,
        `Surgery slots ${verb}`,
        `${hospital.name} ${verb} your ${rows[0].operation?.name_en ?? 'surgery'} slots: ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? ` and ${dates.length - 5} more` : ''}.`,
        PATH.doctorHospitals,
      );
    }
    return slots.map(({ operation: _op, doctor: _doc, ...row }) => row);
  }

  async replaceMyOverrides(userId: string, items: HospitalOverrideInput[]) {
    const hospital = await this.mine(userId);
    await this.assertActiveOperations(
      items.map((i) => i.operation_id).filter((id): id is string => !!id),
    );
    await this.assertLinkedDoctors(
      hospital.id,
      items.map((i) => i.doctor_id).filter((id): id is string => !!id),
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
        doctor_id: i.doctor_id || null,
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

  private async assertLinkedDoctors(hospitalId: string, doctorIds: string[]) {
    const ids = [...new Set(doctorIds)];
    if (!ids.length) return;
    const count = await this.linkRepo.count({
      where: { hospital_id: hospitalId, doctor_id: In(ids), status: 'approved' },
    });
    if (count !== ids.length) {
      throw new BadRequestException('Only doctors who accepted your invitation can have slots');
    }
  }

  /** Each slot's doctor must be assigned to that surgery at this hospital. */
  private async assertBookableDoctors(
    hospitalId: string,
    items: { doctor_id: string; operation_id: string }[],
  ) {
    if (!items.length) return;
    const surgeries = await this.surgeryRepo.find({
      where: { hospital_id: hospitalId, operation_id: In([...new Set(items.map((i) => i.operation_id))]) },
    });
    const assigned = new Set(surgeries.flatMap((s) => s.doctor_ids.map((d) => `${d}:${s.operation_id}`)));
    items.forEach((i, idx) => {
      if (!assigned.has(`${i.doctor_id}:${i.operation_id}`)) {
        throw new BadRequestException(
          `row ${idx}: this doctor is not assigned to this surgery at the hospital`,
        );
      }
    });
  }

  /** Doctors must practise the operation's speciality (primary or extra). */
  private async assertPractises(doctorIds: string[], specialityId: string) {
    if (!doctorIds.length) return;
    const rows: { doctor_id: string }[] = await this.doctorRepo.query(
      `SELECT id AS doctor_id FROM doctors WHERE id = ANY($1) AND speciality_id = $2
       UNION
       SELECT doctor_id FROM doctor_speciality_links WHERE doctor_id = ANY($1) AND speciality_id = $2`,
      [doctorIds, specialityId],
    );
    if (rows.length !== doctorIds.length) {
      throw new BadRequestException("Some doctors don't practise this surgery's speciality");
    }
  }

  // ── Surgeries the hospital offers + assigned doctors ────────────────
  private surgeriesOf(hospitalId: string) {
    return this.surgeryRepo.find({
      where: { hospital_id: hospitalId },
      relations: ['operation', 'operation.speciality'],
      order: { created_at: 'ASC' },
    });
  }

  /** Add a surgery or change who performs it; unassigned doctors lose their slots for it. */
  async setSurgery(userId: string, operationId: string, doctorIds: string[]) {
    const hospital = await this.mine(userId);
    const op = await this.operationRepo.findOne({ where: { id: operationId, is_active: true } });
    // Another hospital's custom surgery isn't ours to offer.
    if (!op || (op.hospital_id && op.hospital_id !== hospital.id)) {
      throw new BadRequestException('Unknown or inactive surgical operation');
    }
    const ids = [...new Set(doctorIds)];
    await this.assertLinkedDoctors(hospital.id, ids);
    await this.assertPractises(ids, op.speciality_id);

    const existing = await this.surgeryRepo.findOne({
      where: { hospital_id: hospital.id, operation_id: operationId },
    });
    const before = existing?.doctor_ids ?? [];
    await this.surgeryRepo.save(
      this.surgeryRepo.create({ hospital_id: hospital.id, operation_id: operationId, doctor_ids: ids }),
    );
    const removed = before.filter((d) => !ids.includes(d));
    if (removed.length) {
      await this.slotRepo.delete({
        hospital_id: hospital.id,
        operation_id: operationId,
        doctor_id: In(removed),
      });
    }
    const added = ids.filter((d) => !before.includes(d));
    if (added.length) {
      const doctors = await this.doctorRepo.find({ where: { id: In(added) } });
      for (const d of doctors) {
        this.notify(
          d.user_id,
          'Assigned to a surgery',
          `${hospital.name} assigned you to ${op.name_en}. Propose your available times in Profile → Surgery availability.`,
          PATH.doctorHospitals,
        );
      }
    }
    return this.surgeriesOf(hospital.id);
  }

  async removeSurgery(userId: string, operationId: string) {
    const hospital = await this.mine(userId);
    await this.surgeryRepo.delete({ hospital_id: hospital.id, operation_id: operationId });
    await this.slotRepo.delete({ hospital_id: hospital.id, operation_id: operationId });
    return { ok: true };
  }

  /** Drop a doctor from every surgery at a hospital (unlinked / declined). */
  private unassignDoctor(hospitalId: string, doctorId: string) {
    return this.surgeryRepo.query(
      `UPDATE hospital_surgeries SET doctor_ids = array_remove(doctor_ids, $1) WHERE hospital_id = $2`,
      [doctorId, hospitalId],
    );
  }

  /** Surgeries this doctor is assigned to at a hospital. */
  async doctorSurgeries(userId: string, hospitalId: string) {
    const doctor = await this.myDoctor(userId);
    const rows = await this.surgeryRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.operation', 'op')
      .where('s.hospital_id = :hospitalId', { hospitalId })
      .andWhere(':doctorId = ANY(s.doctor_ids)', { doctorId: doctor.id })
      .getMany();
    return rows.map((r) => r.operation).filter((o) => o?.is_active);
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

  /**
   * Record one side's decision (hospital or doctor) and update the overall
   * status. The patient hears once it's final; the other side hears either way.
   */
  private async decideAs(
    party: 'hospital' | 'doctor',
    r: SurgeryReservation,
    decision: 'approved' | 'rejected',
  ) {
    const field = party === 'hospital' ? 'hospital_status' : 'doctor_status';
    // Conditional update so a repeat/late decision can't overwrite a final one.
    const { affected } = await this.reservationRepo
      .createQueryBuilder()
      .update()
      .set({ [field]: decision })
      .where('id = :id AND status = :pending AND ' + field + ' = :pending', { id: r.id, pending: 'pending' })
      .execute();
    if (!affected) {
      throw new BadRequestException(`Reservation is already ${r.status === 'pending' ? r[field] : r.status}`);
    }
    // Recompute from the stored row: either side rejecting rejects it; both approving
    // approves it. Reading the row (not this request's copy) keeps simultaneous
    // hospital + doctor approvals from leaving it stuck as pending.
    await this.reservationRepo.query(
      `UPDATE surgery_reservations SET status = CASE
         WHEN hospital_status = 'rejected' OR doctor_status = 'rejected' THEN 'rejected'
         WHEN hospital_status = 'approved' AND doctor_status = 'approved' THEN 'approved'
         ELSE 'pending' END
       WHERE id = $1 AND status = 'pending'`,
      [r.id],
    );
    Object.assign(r, await this.reservationRepo.findOneByOrFail({ id: r.id }));

    const full = await this.loadReservation(r.id);
    const what = `${full.operation?.name_en ?? 'surgery'} at ${full.hospital?.name ?? 'the hospital'} on ${r.date} ${r.time.slice(0, 5)}`;
    const who = party === 'hospital' ? full.hospital?.name ?? 'The hospital' : `Dr. ${full.doctor?.name ?? ''}`.trim();
    const patient = await this.patientName(r.patient_user_id);

    if (r.status !== 'pending') {
      this.notify(
        r.patient_user_id,
        `Surgery reservation ${r.status}`,
        r.status === 'approved'
          ? `Your ${what} is confirmed by the hospital and the doctor.`
          : `Your ${what} was rejected by ${who}.`,
        PATH.patient,
        { reservationId: r.id },
      );
    }
    // Tell the other side what happened (and whether it now waits on them).
    const waitingOnOther = r.status === 'pending';
    const otherUserId = party === 'hospital' ? full.doctor?.user_id : full.hospital?.owner_id;
    this.notify(
      otherUserId,
      `${who} ${decision} a surgery reservation`,
      `${who} ${decision} ${patient}'s ${what}.${waitingOnOther ? ' Your approval is still needed.' : ''}`,
      party === 'hospital' ? PATH.doctor : PATH.hospitalReservations,
      { reservationId: r.id },
    );
    return full;
  }

  async decide(userId: string, id: string, status: 'approved' | 'rejected') {
    const hospital = await this.mine(userId);
    const r = await this.reservationRepo.findOne({ where: { id, hospital_id: hospital.id } });
    if (!r) throw new NotFoundException('Reservation not found');
    return this.decideAs('hospital', r, status);
  }

  async doctorDecide(userId: string, id: string, status: 'approved' | 'rejected') {
    const doctor = await this.myDoctor(userId);
    const r = await this.reservationRepo.findOne({ where: { id, doctor_id: doctor.id } });
    if (!r) throw new NotFoundException('Reservation not found');
    return this.decideAs('doctor', r, status);
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
    if (status === 'rejected') {
      await this.slotRepo.delete({ hospital_id: hospitalId, doctor_id: doctor.id });
      await this.unassignDoctor(hospitalId, doctor.id);
    }
    this.notify(
      link.hospital?.owner_id,
      status === 'approved' ? 'Doctor joined your hospital' : 'Doctor declined your invitation',
      `Dr. ${doctor.name} ${status === 'approved' ? 'accepted' : 'declined'} the invitation to ${link.hospital?.name}.`,
      PATH.hospitalDoctors,
    );
    return { hospital_id: link.hospital_id, doctor_id: link.doctor_id, status: link.status };
  }

  /** The doctor's windows at one hospital (approved, pending and rejected). */
  async doctorSlots(userId: string, hospitalId: string) {
    const doctor = await this.myDoctor(userId);
    return this.slotRepo.find({
      where: { hospital_id: hospitalId, doctor_id: doctor.id },
      relations: ['operation'],
      order: { date: 'ASC', day_of_week: 'ASC', start_time: 'ASC' },
    });
  }

  /**
   * Doctor proposes windows (usually specific dates) at a hospital they joined.
   * They stay pending until the hospital approves them.
   */
  async proposeSlots(
    userId: string,
    hospitalId: string,
    items: Omit<HospitalSlotInput, 'doctor_id'>[],
  ) {
    const doctor = await this.myDoctor(userId);
    const hospital = await this.hospitalRepo.findOne({ where: { id: hospitalId } });
    if (!hospital) throw new NotFoundException('Hospital not found');
    const rows = await this.buildSlotRows(
      hospital.id,
      items.map((i) => ({ ...i, doctor_id: doctor.id })),
      'pending',
      'doctor',
    );
    // Adds to earlier proposals; re-proposing a date replaces that date's
    // pending/rejected window for the same operation.
    for (const operationId of new Set(rows.map((r) => r.operation_id))) {
      const dates = rows.filter((r) => r.operation_id === operationId && r.date).map((r) => r.date!);
      if (!dates.length) continue;
      await this.slotRepo.delete({
        hospital_id: hospital.id,
        doctor_id: doctor.id,
        operation_id: operationId,
        date: In(dates),
        status: In(['pending', 'rejected']),
      });
    }
    if (rows.length) {
      await this.slotRepo.save(rows);
      this.notify(
        hospital.owner_id,
        'New surgery slots to review',
        `Dr. ${doctor.name} proposed surgery slots on ${rows.length} day${rows.length === 1 ? '' : 's'}. Approve or reject them on your Availability page.`,
        PATH.hospital,
      );
    }
    return this.doctorSlots(userId, hospitalId);
  }

  /** Doctor withdraws one of their proposals (approved windows are the hospital's to remove). */
  async deleteProposal(userId: string, hospitalId: string, slotId: string) {
    const doctor = await this.myDoctor(userId);
    const res = await this.slotRepo.delete({
      id: slotId,
      hospital_id: hospitalId,
      doctor_id: doctor.id,
      status: In(['pending', 'rejected']),
    });
    if (!res.affected) throw new NotFoundException('Proposal not found');
    return { ok: true };
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
    const [day] = await this.availability(hospital.id, dto.operation_id, dto.doctor_id, dto.date, 1);
    const slot = day?.date === dto.date ? day.slots.find((s) => s.time === time) : undefined;
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
          hospital_status: 'pending',
          doctor_status: 'pending',
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
      `${patient} requested ${what}. Approve or reject it in your dashboard (the doctor must approve too).`,
      PATH.hospitalReservations,
      { reservationId: saved.id },
    );
    this.notify(
      full.doctor?.user_id,
      'New surgery reservation',
      `${patient} requested ${full.operation?.name_en ?? 'surgery'} with you at ${hospital.name} on ${dto.date} ${time}. Approve or reject it in Surgeries (the hospital must approve too).`,
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
    await this.reservationRepo.save(r);

    const full = await this.loadReservation(r.id);
    const body = `${await this.patientName(userId)} cancelled ${full.operation?.name_en ?? 'surgery'} on ${r.date} ${r.time.slice(0, 5)}. The slot is free again.`;
    this.notify(full.hospital?.owner_id, 'Surgery reservation cancelled', body, PATH.hospitalReservations, {
      reservationId: r.id,
    });
    this.notify(full.doctor?.user_id, 'Surgery reservation cancelled', body, PATH.doctor, {
      reservationId: r.id,
    });
    return full;
  }
}
