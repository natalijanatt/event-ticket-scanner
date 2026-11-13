import { Body, Controller, Get, Module, Param, Patch, Post, Put } from '@nestjs/common';
import {
  eventStaffSchema,
  staffCreateSchema,
  staffUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  type EventStaffInput,
  type StaffCreateInput,
  type StaffDto,
  type StaffUpdateInput,
  type UserCreateInput,
  type UserDto,
  type UserUpdateInput,
} from '@event-platform/shared';
import type { RequestUser } from '../auth/auth.types';
import { AdminOnly, CurrentUser, Roles } from '../auth/decorators';
import { Uuid } from '../common/uuid.pipe';
import { zod } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';

@Roles('SUPER_ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserDto[]> {
    return this.users.listUsers();
  }

  @Post()
  create(@CurrentUser() actor: RequestUser, @Body(zod(userCreateSchema)) body: UserCreateInput): Promise<UserDto> {
    return this.users.createUser(actor, body);
  }

  @Patch(':userId')
  update(
    @CurrentUser() actor: RequestUser,
    @Param('userId', Uuid) userId: string,
    @Body(zod(userUpdateSchema)) body: UserUpdateInput,
  ): Promise<UserDto> {
    return this.users.updateUser(actor, userId, body);
  }
}

@AdminOnly()
@Controller()
export class StaffController {
  constructor(private readonly users: UsersService) {}

  @Get('staff')
  list(@CurrentUser() actor: RequestUser): Promise<StaffDto[]> {
    return this.users.listStaff(actor);
  }

  @Post('staff')
  create(@CurrentUser() actor: RequestUser, @Body(zod(staffCreateSchema)) body: StaffCreateInput): Promise<StaffDto> {
    return this.users.createStaff(actor, body);
  }

  @Patch('staff/:staffId')
  update(
    @CurrentUser() actor: RequestUser,
    @Param('staffId', Uuid) staffId: string,
    @Body(zod(staffUpdateSchema)) body: StaffUpdateInput,
  ): Promise<StaffDto> {
    return this.users.updateStaff(actor, staffId, body);
  }

  @Get('events/:eventId/staff')
  eventStaff(@CurrentUser() actor: RequestUser, @Param('eventId', Uuid) eventId: string): Promise<{ assignedIds: string[]; staff: StaffDto[] }> {
    return this.users.eventStaff(actor, eventId);
  }

  @Put('events/:eventId/staff')
  setEventStaff(
    @CurrentUser() actor: RequestUser,
    @Param('eventId', Uuid) eventId: string,
    @Body(zod(eventStaffSchema)) body: EventStaffInput,
  ): Promise<{ assignedIds: string[] }> {
    return this.users.setEventStaff(actor, eventId, body.userIds);
  }
}

@Module({ controllers: [UsersController, StaffController], providers: [UsersService] })
export class UsersModule {}
