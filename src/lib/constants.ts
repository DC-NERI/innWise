
export const ROOM_AVAILABILITY_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
} as const;

export const ROOM_AVAILABILITY_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_AVAILABILITY_STATUS.AVAILABLE]: 'Available',
  [ROOM_AVAILABILITY_STATUS.OCCUPIED]: 'Occupied',
  [ROOM_AVAILABILITY_STATUS.RESERVED]: 'Reserved',
};

export const ROOM_CLEANING_STATUS = {
  CLEAN: 'clean',
  DIRTY: 'dirty',
  INSPECTION: 'inspection',
  OUT_OF_ORDER: 'out_of_order',
} as const;

export const ROOM_CLEANING_STATUS_TEXT: { [key: string]: string } = {
  [ROOM_CLEANING_STATUS.CLEAN]: 'Clean',
  [ROOM_CLEANING_STATUS.DIRTY]: 'Dirty',
  [ROOM_CLEANING_STATUS.INSPECTION]: 'Needs Inspection',
  [ROOM_CLEANING_STATUS.OUT_OF_ORDER]: 'Out of Order',
};
export const ROOM_CLEANING_STATUS_OPTIONS = Object.values(ROOM_CLEANING_STATUS).map(value => ({
  value: value,
  label: ROOM_CLEANING_STATUS_TEXT[value]
}));


export const TRANSACTION_STATUS = {
  UNPAID: '0',
  PAID: '1',
  ADVANCE_PAID: '2',
  CANCELLED: '3',
  ADVANCE_RESERVATION: '4',
  PENDING_BRANCH_ACCEPTANCE: '5',
} as const;

export const TRANSACTION_STATUS_TEXT: { [key: string]: string } = {
  [TRANSACTION_STATUS.UNPAID]: 'Unpaid / Occupied',
  [TRANSACTION_STATUS.PAID]: 'Paid',
  [TRANSACTION_STATUS.ADVANCE_PAID]: 'Advance Paid', // For staff-created reservations directly
  [TRANSACTION_STATUS.CANCELLED]: 'Cancelled',
  [TRANSACTION_STATUS.ADVANCE_RESERVATION]: 'Advance Reservation', // For staff-created future reservations
  [TRANSACTION_STATUS.PENDING_BRANCH_ACCEPTANCE]: 'Pending Branch Acceptance', // For admin-created reservations
};

export const NOTIFICATION_STATUS = {
  UNREAD: 0,
  READ: 1,
} as const;

export const NOTIFICATION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_STATUS.UNREAD]: 'Unread',
  [NOTIFICATION_STATUS.READ]: 'Read',
};

export const NOTIFICATION_TRANSACTION_STATUS = {
  PENDING_ACTION: 0,
  RESERVATION_CREATED: 1,
} as const;

export const NOTIFICATION_TRANSACTION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_STATUS.PENDING_ACTION]: 'Pending Action',
  [NOTIFICATION_TRANSACTION_STATUS.RESERVATION_CREATED]: 'Reservation Created',
};

export const TRANSACTION_IS_ACCEPTED_STATUS = {
    DEFAULT: 0,
    NOT_ACCEPTED: 1,
    ACCEPTED: 2,
    PENDING: 3,
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'N/A',
    [TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED]: 'Not Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED]: 'Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.PENDING]: 'Pending Branch Action',
};

export const NOTIFICATION_TYPES = {
  GENERAL: 'General',
  RESERVATION_REQUEST: 'Reservation Request',
  GUEST_REQUEST: 'Guest Request',
  MAINTENANCE: 'Maintenance Alert',
  ADMIN_ALERT: 'Admin Alert',
} as const;

export const NOTIFICATION_TYPE_OPTIONS = Object.values(NOTIFICATION_TYPES).map(value => ({
  value: value,
  label: value
}));

export const NOTIFICATION_PRIORITY = {
  NORMAL: 0,
  HIGH: 1,
} as const;

export const NOTIFICATION_PRIORITY_TEXT: { [key: number]: string } = {
  [NOTIFICATION_PRIORITY.NORMAL]: 'Normal',
  [NOTIFICATION_PRIORITY.HIGH]: 'High',
};
export const NOTIFICATION_PRIORITY_OPTIONS = [
  { value: NOTIFICATION_PRIORITY.NORMAL.toString(), label: NOTIFICATION_PRIORITY_TEXT[NOTIFICATION_PRIORITY.NORMAL]},
  { value: NOTIFICATION_PRIORITY.HIGH.toString(), label: NOTIFICATION_PRIORITY_TEXT[NOTIFICATION_PRIORITY.HIGH]}
];
