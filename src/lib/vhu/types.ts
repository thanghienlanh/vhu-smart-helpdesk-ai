// Shared types for the VHU Smart Helpdesk AI ticket workflow.
// Mirrors the DB enums added in supabase/migrations/035_vhu_smart_helpdesk.sql.

export const VHU_TICKET_STATUSES = [
  'NEW',
  'AI_ANALYZED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_USER',
  'WAITING_CONFIRMATION',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
] as const;

export type VhuTicketStatus = (typeof VHU_TICKET_STATUSES)[number];

export const AI_PROCESS_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type AiProcessStatus = (typeof AI_PROCESS_STATUSES)[number];

// Reuses the inherited `priority_level` Postgres enum (low/medium/high/critical).
// 'critical' carries the Vietnamese label "Khẩn cấp" (URGENT) throughout the UI.
export const VHU_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type VhuPriority = (typeof VHU_PRIORITIES)[number];

export type AppRole = 'user' | 'agent' | 'manager' | 'admin';

export const STATUS_LABELS_VI: Record<VhuTicketStatus, string> = {
  NEW: 'Mới tạo',
  AI_ANALYZED: 'AI đã phân tích',
  ASSIGNED: 'Đã phân công',
  IN_PROGRESS: 'Đang xử lý',
  WAITING_USER: 'Chờ người dùng phản hồi',
  WAITING_CONFIRMATION: 'Chờ người dùng xác nhận',
  RESOLVED: 'Đã khắc phục',
  CLOSED: 'Đã đóng',
  REOPENED: 'Yêu cầu xử lý lại',
  CANCELLED: 'Đã hủy',
};

// Tailwind badge classes, aligned with the design-system palette already used
// for Badge.tsx elsewhere in the inherited UI.
export const STATUS_BADGE_CLASSES: Record<VhuTicketStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  AI_ANALYZED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  ASSIGNED: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  WAITING_USER: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  WAITING_CONFIRMATION: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  RESOLVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  CLOSED: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  REOPENED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 line-through',
};

export const PRIORITY_LABELS_VI: Record<VhuPriority, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Khẩn cấp',
};

export const PRIORITY_BADGE_CLASSES: Record<VhuPriority, string> = {
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  medium: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

export const ROLE_LABELS_VI: Record<AppRole, string> = {
  user: 'Người gửi yêu cầu',
  agent: 'Nhân viên hỗ trợ',
  manager: 'Quản lý',
  admin: 'Quản trị viên',
};

// Client-safe mirror of the `ticket_status_transitions` table seeded in the
// migration. This is used to render the correct action buttons in the UI;
// the database trigger (`validate_ticket_status_transition`) and the Server
// Actions in `src/lib/actions/vhu-tickets.ts` are the actual enforcement
// points — this table must never be trusted on its own for authorization.
export const STATUS_TRANSITIONS: Record<VhuTicketStatus, Partial<Record<VhuTicketStatus, AppRole[]>>> = {
  NEW: {
    AI_ANALYZED: ['manager', 'admin'],
    CANCELLED: ['user', 'manager', 'admin'],
  },
  AI_ANALYZED: {
    ASSIGNED: ['manager', 'admin'],
    CANCELLED: ['user', 'manager', 'admin'],
  },
  ASSIGNED: {
    IN_PROGRESS: ['agent', 'manager', 'admin'],
    CANCELLED: ['user', 'manager', 'admin'],
  },
  IN_PROGRESS: {
    WAITING_USER: ['agent', 'manager', 'admin'],
    WAITING_CONFIRMATION: ['agent', 'manager', 'admin'],
    ASSIGNED: ['agent', 'manager', 'admin'],
  },
  WAITING_USER: {
    IN_PROGRESS: ['agent', 'user', 'manager', 'admin'],
    WAITING_CONFIRMATION: ['agent', 'manager', 'admin'],
  },
  WAITING_CONFIRMATION: {
    RESOLVED: ['user', 'manager', 'admin'],
    REOPENED: ['user', 'manager', 'admin'],
    IN_PROGRESS: ['agent', 'manager', 'admin'],
  },
  RESOLVED: {
    CLOSED: ['manager', 'admin'],
    REOPENED: ['user', 'manager', 'admin'],
  },
  CLOSED: {
    REOPENED: ['user', 'manager', 'admin'],
  },
  REOPENED: {
    ASSIGNED: ['agent', 'manager', 'admin'],
    IN_PROGRESS: ['agent', 'manager', 'admin'],
  },
  CANCELLED: {},
};

export function canTransition(from: VhuTicketStatus, to: VhuTicketStatus, role: AppRole): boolean {
  const allowedRoles = STATUS_TRANSITIONS[from]?.[to];
  return !!allowedRoles && allowedRoles.includes(role);
}

export const IT_CATEGORY_NAMES = [
  'Mạng Internet',
  'Máy tính phòng học',
  'Máy chiếu',
  'Thiết bị phòng học',
  'Email trường',
  'Tài khoản sinh viên',
  'Cổng thông tin sinh viên',
  'Phần mềm đào tạo',
  'Cài đặt phần mềm',
  'An toàn thông tin',
  'Máy in',
  'Yêu cầu khác',
] as const;
