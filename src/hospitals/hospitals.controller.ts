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
  CreateHospitalOperationDto,
  CreateSurgeryReservationDto,
  CreateSurgicalOperationDto,
  DecideSlotsDto,
  DecideReservationDto,
  InviteDoctorDto,
  ProposeSlotsDto,
  ReplaceHospitalOverridesDto,
  ReplaceHospitalSlotsDto,
  RespondLinkDto,
  SetSurgeryDoctorsDto,
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
  @Get('hospitals/:id/operations/:operationId/doctors/:doctorId/availability')
  availability(
    @Param('id', uuid) id: string,
    @Param('operationId', uuid) operationId: string,
    @Param('doctorId', uuid) doctorId: string,
    @Query('from') from?: string,
    @Query('days') days?: string,
  ) {
    return this.service.availability(id, operationId, doctorId, from, Number(days) || 14);
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
  @Patch('hospital/me/slots')
  decideSlots(@Body() dto: DecideSlotsDto, @Request() req) {
    return this.service.decideSlots(req.user.id, dto.ids, dto.status);
  }

  @Roles('hospital')
  @Get('hospital/me/operations')
  hospitalOperations(@Request() req) {
    return this.service.hospitalOperations(req.user.id);
  }

  @Roles('hospital')
  @Post('hospital/me/operations')
  createHospitalOperation(@Body() dto: CreateHospitalOperationDto, @Request() req) {
    return this.service.createHospitalOperation(req.user.id, dto);
  }

  @Roles('hospital')
  @Put('hospital/me/surgeries/:operationId')
  setSurgery(
    @Param('operationId', uuid) operationId: string,
    @Body() dto: SetSurgeryDoctorsDto,
    @Request() req,
  ) {
    return this.service.setSurgery(req.user.id, operationId, dto.doctor_ids);
  }

  @Roles('hospital')
  @Delete('hospital/me/surgeries/:operationId')
  removeSurgery(@Param('operationId', uuid) operationId: string, @Request() req) {
    return this.service.removeSurgery(req.user.id, operationId);
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
  @Get('doctor/hospitals/:hospitalId/surgeries')
  doctorSurgeries(@Param('hospitalId', uuid) hospitalId: string, @Request() req) {
    return this.service.doctorSurgeries(req.user.id, hospitalId);
  }

  @Roles('doctor')
  @Get('doctor/hospitals/:hospitalId/slots')
  doctorSlots(@Param('hospitalId', uuid) hospitalId: string, @Request() req) {
    return this.service.doctorSlots(req.user.id, hospitalId);
  }

  @Roles('doctor')
  @Put('doctor/hospitals/:hospitalId/slots')
  proposeSlots(
    @Param('hospitalId', uuid) hospitalId: string,
    @Body() dto: ProposeSlotsDto,
    @Request() req,
  ) {
    return this.service.proposeSlots(req.user.id, hospitalId, dto.items);
  }

  @Roles('doctor')
  @Delete('doctor/hospitals/:hospitalId/slots/:id')
  deleteProposal(
    @Param('hospitalId', uuid) hospitalId: string,
    @Param('id', uuid) id: string,
    @Request() req,
  ) {
    return this.service.deleteProposal(req.user.id, hospitalId, id);
  }

  @Roles('doctor')
  @Get('doctor/surgery-reservations')
  doctorReservations(@Request() req) {
    return this.service.doctorReservations(req.user.id);
  }

  @Roles('doctor')
  @Patch('doctor/surgery-reservations/:id')
  doctorDecide(
    @Param('id', uuid) id: string,
    @Body() dto: DecideReservationDto,
    @Request() req,
  ) {
    return this.service.doctorDecide(req.user.id, id, dto.status);
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
