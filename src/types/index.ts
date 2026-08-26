export type UserRole = "EMPLOYEE" | "ADMIN";
export type UserStatus = "OFFLINE" | "WORKING" | "ON_BREAK" | "LATE";
export type ShiftStatus = "ACTIVE" | "ENDED";
export type BreakStatus =
  | "SCHEDULED"
  | "ACTIVE"
  | "COMPLETED"
  | "LATE"
  | "SKIPPED";

export interface BreakScheduleInput {
  scheduledStart: Date;
  scheduledEnd: Date;
}

export interface ExistingBreakSlot {
  userId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
}

export interface SchedulerSettings {
  workDurationMinutes: number;
  breakDurationMinutes: number;
  maxConcurrentBreaks: number;
}

export interface ShiftReport {
  startedAt: Date;
  endedAt: Date;
  shiftDurationMinutes: number;
  breakCount: number;
  allowedBreakMinutes: number;
  actualBreakMinutes: number;
  totalDelayMinutes: number;
  onTimeBreaks: number;
  lateBreaks: number;
}

export interface TimelineEvent {
  time: string;
  label: string;
  icon: string;
  type: "shift_start" | "break" | "return" | "shift_end";
}

export interface EmployeeDashboardState {
  hasActiveShift: boolean;
  shiftEnded: boolean;
  userStatus: UserStatus;
  serverTime: string;
  shiftStartedAt?: string;
  shiftEndedAt?: string;
  currentBreak?: {
    id: string;
    scheduledStart: string;
    scheduledEnd: string;
    actualStart?: string;
    status: BreakStatus;
  };
  nextBreak?: { scheduledStart: string; scheduledEnd: string };
  timerLabel: string;
  timerSeconds: number;
  stats: {
    breakCount: number;
    totalBreakMinutes: number;
    allowedBreakMinutes: number;
    totalDelayMinutes: number;
    completedBreaks: number;
    lateBreaks: number;
  };
  timeline: TimelineEvent[];
  report?: ShiftReport;
  settings: FullSettings;
}

export type FullSettings = SchedulerSettings & {
  earlyNotificationMinutes: number;
  endNotificationMinutes: number;
};

export interface AdminEmployeeView {
  id: string;
  name: string;
  username: string;
  status: UserStatus;
  statusLabel: string;
  breakInfo: string;
  delayMinutes: number;
}

export interface AdminDashboardState {
  serverTime: string;
  stats: {
    total: number;
    working: number;
    onBreak: number;
    late: number;
    offline: number;
  };
  employees: AdminEmployeeView[];
  settings: SchedulerSettings & {
    earlyNotificationMinutes: number;
    endNotificationMinutes: number;
  };
}
