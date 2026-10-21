import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { HospitalsService } from './hospitals.service';
import {
  AdminHospitalDto,
  CreateHospitalDto,
  CreateSurgeryReservationDto,
  CreateSurgicalOperationDto,
  DecideReservationDto,
  InviteDoctorDto,
  ReplaceHospitalOverridesDto,
  ReplaceHospitalSlotsDto,
  RespondLinkDto,
  UpdateHospitalDto,
  UpdateSurgicalOperationDto,
} from './dto/hospital.dto';

const uuid = new ParseUUIDPipe();

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class HospitalsController {
  constructor(private readonly service: HospitalsService) {}

  // ── Public browse ───────────────────────────────────────────────────
  @Public()
  @Get('surgical-operations')
  listOperations(@Query('speciality_id') specialityId?: string) {
    return this.service.listOperations(specialityId || undefined);
  }

  @Public()
  @Get('hospitals')
  listHospitals(@Query('operation_id') operationId?: string) {
    return this.service.listHospitals(operationId || undefined);
  }

  @Public()
  @Get('hospitals/:id/doctors')
  hospitalDoctors(
    @Param('id', uuid) id: string,
    @Query('operation_id') operationId?: string,
  ) {
    return this.service.hospitalDoctors(id, operationId || undefined);
  }

  @Public()
  @Get('hospitals/:id/operations/:operationId/slots')
  slots(
    @Param('id', uuid) id: string,
    @Param('operationId', uuid) operationId: string,
    @Query('date') date: string,
  ) {
    return this.service.availableSlots(id, operationId, date);
  }

  // ── Admin ───────────────────────────────────────────────────────────
  @Roles('admin')
  @Get('admin/surgical-operations')
  adminListOperations() {
    return this.service.listOperations(undefined, true);
  }

  @Roles('admin')
  @Post('admin/surgical-operations')
  createOperation(@Body() dto: CreateSurgicalOperationDto) {
    return this.service.createOperation(dto);
  }

  @Roles('admin')
  @Patch('admin/surgical-operations/:id')
  updateOperation(@Param('id', uuid) id: string, @Body() dto: UpdateSurgicalOperationDto) {
    return this.service.updateOperation(id, dto);
  }

  @Roles('admin')
  @Delete('admin/surgical-operations/:id')
  deleteOperation(@Param('id', uuid) id: string) {
    return this.service.deleteOperation(id);
  }

  @Roles('admin')
  @Get('admin/hospitals')
  adminListHospitals() {
    return this.service.listHospitalsAdmin();
  }

  @Roles('admin')
  @Post('admin/hospitals')
  createHospital(@Body() dto: CreateHospitalDto) {
    return this.service.createHospital(dto);
  }

  @Roles('admin')
  @Patch('admin/hospitals/:id')
  updateHospital(@Param('id', uuid) id: string, @Body() dto: AdminHospitalDto) {
    return this.service.updateHospital(id, dto);
  }

  @Roles('admin')
  @Delete('admin/hospitals/:id')
  deleteHospital(@Param('id', uuid) id: string) {
    return this.service.deleteHospital(id);
  }

  // ── Hospital account ────────────────────────────────────────────────
  @Roles('hospital')
  @Get('hospital/me')
  getMine(@Request() req) {
    return this.service.getMine(req.user.id);
  }

  @Roles('hospital')
  @Patch('hospital/me')
  updateMine(@Body() dto: UpdateHospitalDto, @Request() req) {
    return this.service.updateMine(req.user.id, dto);
  }

  @Roles('hospital')
  @Get('hospital/doctors/search')
  searchDoctors(@Query('q') q: string) {
    return this.service.searchDoctors(q);
  }

  @Roles('hospital')
  @Post('hospital/me/doctors')
  inviteDoctor(@Body() dto: InviteDoctorDto, @Request() req) {
    return this.service.inviteDoctor(req.user.id, dto.doctor_id);
  }

  @Roles('hospital')
  @Delete('hospital/me/doctors/:doctorId')
  removeDoctor(@Param('doctorId', uuid) doctorId: string, @Request() req) {
    return this.service.removeDoctor(req.user.id, doctorId);
  }

  @Roles('hospital')
  @Put('hospital/me/overrides')
  replaceMyOverrides(@Body() dto: ReplaceHospitalOverridesDto, @Request() req) {
    return this.service.replaceMyOverrides(req.user.id, dto.items);
  }

  @Roles('hospital')
  @Put('hospital/me/slots')
  replaceMySlots(@Body() dto: ReplaceHospitalSlotsDto, @Request() req) {
    return this.service.replaceMySlots(req.user.id, dto.items);
  }

  @Roles('hospital')
  @Get('hospital/me/reservations')
  myHospitalReservations(@Request() req) {
    return this.service.myHospitalReservations(req.user.id);
  }

  @Roles('hospital')
  @Patch('hospital/me/reservations/:id')
  decide(
    @Param('id', uuid) id: string,
    @Body() dto: DecideReservationDto,
    @Request() req,
  ) {
    return this.service.decide(req.user.id, id, dto.status);
  }

  // ── Doctor ──────────────────────────────────────────────────────────
  @Roles('doctor')
  @Get('doctor/hospital-links')
  doctorLinks(@Request() req) {
    return this.service.doctorLinks(req.user.id);
  }

  @Roles('doctor')
  @Patch('doctor/hospital-links/:hospitalId')
  respondLink(
    @Param('hospitalId', uuid) hospitalId: string,
    @Body() dto: RespondLinkDto,
    @Request() req,
  ) {
    return this.service.respondLink(req.user.id, hospitalId, dto.status);
  }

  @Roles('doctor')
  @Get('doctor/surgery-reservations')
  doctorReservations(@Request() req) {
    return this.service.doctorReservations(req.user.id);
  }

  // ── Patient ─────────────────────────────────────────────────────────
  @Roles('patient')
  @Post('surgery-reservations')
  reserve(@Body() dto: CreateSurgeryReservationDto, @Request() req) {
    return this.service.reserve(req.user.id, dto);
  }

  @Roles('patient')
  @Get('surgery-reservations/me')
  myReservations(@Request() req) {
    return this.service.myPatientReservations(req.user.id);
  }

  @Roles('patient')
  @Patch('surgery-reservations/:id/cancel')
  cancel(@Param('id', uuid) id: string, @Request() req) {
    return this.service.cancel(req.user.id, id);
  }
}
