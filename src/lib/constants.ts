
export const ROOM_AVAILABILITY_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  // RESERVED status for a room is now determined by checking its linked transaction's status.
  // We keep 2 here if any old logic might still refer to it, but primary logic will use transaction status.
  RESERVED: 2,
} as const;

export const ROOM_AVAILABILITY_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_AVAILABILITY_STATUS.AVAILABLE]: 'Available',
  [ROOM_AVAILABILITY_STATUS.OCCUPIED]: 'Occupied',
  [ROOM_AVAILABILITY_STATUS.RESERVED]: 'Reserved', // This might be used for display based on transaction
};

export const HOTEL_ENTITY_STATUS = {
  ARCHIVED: '0',
  ACTIVE: '1',
} as const;

export const ROOM_CLEANING_STATUS = {
  CLEAN: 0,
  DIRTY: 1,
  INSPECTION: 2, // Needs Inspection
  OUT_OF_ORDER: 3,
} as const;

export const ROOM_CLEANING_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_CLEANING_STATUS.CLEAN]: 'Clean',
  [ROOM_CLEANING_STATUS.DIRTY]: 'Dirty',
  [ROOM_CLEANING_STATUS.INSPECTION]: 'Needs Inspection',
  [ROOM_CLEANING_STATUS.OUT_OF_ORDER]: 'Out of Order',
};

export const ROOM_CLEANING_STATUS_OPTIONS = Object.values(ROOM_CLEANING_STATUS).map(value => ({
  value: value,
  label: ROOM_CLEANING_STATUS_TEXT[value]
}));

export const NOTIFICATION_STATUS = {
  UNREAD: 0,
  READ: 1,
} as const;

export const NOTIFICATION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_STATUS.UNREAD]: 'Unread',
  [NOTIFICATION_STATUS.READ]: 'Read',
};

export const NOTIFICATION_TRANSACTION_LINK_STATUS = {
  NO_TRANSACTION: 0,
  TRANSACTION_LINKED: 1,
} as const;

export const NOTIFICATION_TRANSACTION_LINK_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_LINK_STATUS.NO_TRANSACTION]: 'No Linked Tx',
  [NOTIFICATION_TRANSACTION_LINK_STATUS.TRANSACTION_LINKED]: 'Tx Linked',
};

// Constants for transaction lifecycle
export const TRANSACTION_LIFECYCLE_STATUS = {
  CHECKED_IN: 0,                // Equivalent to old 'Unpaid/Occupied'
  CHECKED_OUT: 1,               // Equivalent to old 'Paid/Completed'
  RESERVATION_WITH_ROOM: 2,     // Equivalent to old 'Advance Paid' for a specific room
  RESERVATION_NO_ROOM: 3,       // For unassigned reservations, potentially paid or just held
  RESERVATION_ADMIN_PENDING: 4, // Admin-created reservation, awaiting branch action
  RESERVATION_DECLINED_ADMIN: 5,// Reservation created by admin, declined by branch
  VOIDED_CANCELLED: 6,          // Any reservation/booking that was voided or cancelled
} as const;

export const TRANSACTION_LIFECYCLE_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN]: 'Checked-In',
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT]: 'Checked-Out',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM]: 'Reserved (Room Assigned)',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM]: 'Reservation (No Room)',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_ADMIN_PENDING]: 'Pending Branch Acceptance',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_DECLINED_ADMIN]: 'Declined by Branch',
  [TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED]: 'Cancelled/Voided',
};


// Constants for transaction payment status
export const TRANSACTION_PAYMENT_STATUS = {
  UNPAID: 0,
  PAID: 1,
  ADVANCE_PAID: 2, // For reservations that are paid in advance
} as const;

export const TRANSACTION_PAYMENT_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_PAYMENT_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_PAYMENT_STATUS.PAID]: 'Paid',
  [TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID]: 'Advance Paid',
};

// Constants for admin-created reservation acceptance by branch
export const TRANSACTION_IS_ACCEPTED_STATUS = {
    DEFAULT: 0,        // Not applicable or not an admin-created reservation
    NOT_ACCEPTED: 1,   // Branch explicitly declined
    ACCEPTED: 2,       // Branch explicitly accepted
    PENDING: 3,        // Admin created, branch has not yet acted
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'N/A',
    [TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED]: 'Declined by Branch',
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
