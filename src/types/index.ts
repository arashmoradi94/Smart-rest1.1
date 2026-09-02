export type UserRole = "EMPLOYEE" | "SUPERVISOR" | "ADMIN";
export type UserStatus =
  | "OFFLINE"
  | "WORKING"
  | "ON_BREAK"
  | "ON_CALL"
  | "WAITING_BUDDY"
  | "LATE";
export type ShiftStatus = "ACTIVE" | "ENDED";
/**
 * Break lifecycle. READY is a client-facing hint for "SCHEDULED break whose
 * window has arrived"; WAIT_BUDDY marks a group break forming. OVERTIME is the
 * ACTIVE-break-past-end state. SKIPPED is kept as a legacy alias of CANCELLED.
 */
export type BreakStatus =
  | "SCHEDULED"
  | "ACTIVE"
  | "COMPLETED"
  | "OVERTIME"
  | "CANCELLED"
  | "SKIPPED"; // legacy alias, read as CANCELLED

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

export interface BreakHistoryItem {
  id: string;
  breakIndex: number;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string;
  actualEnd?: string;
  durationMinutes?: number;
  startDelayMinutes: number;
  endDelayMinutes: number;
  status: BreakStatus;
  group: boolean;
}

export interface GroupMemberView {
  userId: string;
  name: string;
  ready: boolean;
  onCall: boolean;
}

export interface GroupBreakView {
  groupBreakId: string;
  status: "FORMING" | "ACTIVE";
  members: GroupMemberView[];
  readyCount: number;
  totalCount: number;
  endsAt?: string;
}

export interface BadgeView {
  key: string;
  label: string;
  icon: string;
  earned: boolean;
}

/** Suggestion-only match for Break Buddy coordination. */
export interface BuddyMatchView {
  userId: string;
  name: string;
  minutesUntilBreak: number;
  scheduledStart: string;
  scheduledEnd: string;
  isBuddy: boolean;
}

export interface EmployeeDashboardState {
  hasActiveShift: boolean;
  shiftEnded: boolean;
  userStatus: UserStatus;
  onCall: boolean;
  focusMode: "WORK" | "BREAK" | "OFF";
  serverTime: string;
  shiftStartedAt?: string;
  shiftEndedAt?: string;
  currentBreak?: {
    id: string;
    scheduledStart: string;
    scheduledEnd: string;
    actualStart?: string;
    endsAt?: string;
    status: BreakStatus;
    group: boolean;
  };
  nextBreak?: { scheduledStart: string; scheduledEnd: string; ready: boolean };
  groupBreak?: GroupBreakView;
  /** Break Buddy offers — informational only, ignorable without consequence. */
  suggestions?: BuddyMatchView[];
  timerLabel: string;
  timerSeconds: number;
  stats: {
    breakCount: number;
    totalBreakMinutes: number;
    allowedBreakMinutes: number;
    totalDelayMinutes: number;
    completedBreaks: number;
    lateBreaks: number;
    todayBreakMinutes: number;
    weekBreakMinutes: number;
    monthBreakMinutes: number;
    todayBreakCount: number;
    weekBreakCount: number;
    monthBreakCount: number;
  };
  timeline: TimelineEvent[];
  history: BreakHistoryItem[];
  report?: ShiftReport;
  settings: FullSettings;
}

export type FullSettings = SchedulerSettings & {
  earlyNotificationMinutes: number;
  endNotificationMinutes: number;
  timezone: string;
  /** Smart Break Buddy feature switch (Supervisor-controlled). */
  groupBreakEnabled: boolean;
  /** Matching window: suggest buddies whose break starts within N minutes. */
  groupSuggestWindowMinutes: number;
  /** Group breaks may consume at most this share of online agents. */
  maxGroupBreakLoadRatio: number;
};

export interface AdminEmployeeView {
  id: string;
  name: string;
  username: string;
  role: string;
  status: UserStatus;
  statusLabel: string;
  onCall: boolean;
  breakInfo: string;
  delayMinutes: number;
  shiftStartedAt?: string;
  shiftEndedAt?: string;
  nextBreakAt?: string;
  currentBreak?: {
    id: string;
    scheduledStart: string;
    scheduledEnd: string;
    actualStart?: string;
    endsAt: string;
    durationMinutes?: number;
    startDelayMinutes?: number;
    endDelayMinutes?: number;
    group: boolean;
  };
  totalBreakMinutes: number;
  breakCount: number;
  countdownSeconds: number;
  buddies: string[];
  coins: number;
  xp: number;
  level: number;
}

export interface AdminDashboardState {
  serverTime: string;
  timezone: string;
  stats: {
    total: number;
    working: number;
    onBreak: number;
    onCall: number;
    waitingBuddy: number;
    late: number;
    offline: number;
    activeBreaks: number;
    remainingCapacity: number;
  };
  employees: AdminEmployeeView[];
  forecast: Array<{
    userId: string;
    name: string;
    scheduledStart: string;
    minutesAway: number;
  }>;
  settings: FullSettings;
}

export interface TeamAnalytics {
  period: "day" | "week" | "month";
  totalWorkMinutes: number;
  totalBreakMinutes: number;
  avgBreakMinutes: number;
  avgDelayMinutes: number;
  onTimePercent: number;
  attendanceCount: number;
  breakCount: number;
  peakTimes: Array<{ hour: number; count: number }>;
  capacityUsagePercent: number;
  employees: Array<{
    userId: string;
    name: string;
    shifts: number;
    workMinutes: number;
    breakCount: number;
    breakMinutes: number;
    delayMinutes: number;
    onTimePercent: number;
  }>;
  dailyBuckets: Array<{ day: string; breakMinutes: number; breakCount: number }>;
}

export interface AuditRow {
  id: string;
  userName: string;
  action: string;
  details?: string;
  createdAt: string;
}
