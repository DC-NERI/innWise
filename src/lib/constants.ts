
// ROOM_AVAILABILITY_STATUS: Integer values
export const ROOM_AVAILABILITY_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2, // A room set aside for a future booking, linked to a transaction with status 2 or 4
} as const;

export const ROOM_AVAILABILITY_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_AVAILABILITY_STATUS.AVAILABLE]: 'Available',
  [ROOM_AVAILABILITY_STATUS.OCCUPIED]: 'Occupied',
  [ROOM_AVAILABILITY_STATUS.RESERVED]: 'Reserved',
};

// HOTEL_ENTITY_STATUS: String values '0', '1', '2'
export const HOTEL_ENTITY_STATUS = {
  ARCHIVED: '0',
  ACTIVE: '1',
  SUSPENDED: '2', // New status for tenants
} as const;

export const HOTEL_ENTITY_STATUS_TEXT: { [key: string]: string } = {
  [HOTEL_ENTITY_STATUS.ARCHIVED]: 'Archived',
  [HOTEL_ENTITY_STATUS.ACTIVE]: 'Active',
  [HOTEL_ENTITY_STATUS.SUSPENDED]: 'Suspended',
};


// ROOM_CLEANING_STATUS: Integer values
export const ROOM_CLEANING_STATUS = {
  CLEAN: 0,
  DIRTY: 1,
  INSPECTION: 2,
  OUT_OF_ORDER: 3,
} as const;

export const ROOM_CLEANING_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_CLEANING_STATUS.CLEAN]: 'Clean',
  [ROOM_CLEANING_STATUS.DIRTY]: 'Dirty',
  [ROOM_CLEANING_STATUS.INSPECTION]: 'Needs Inspection',
  [ROOM_CLEANING_STATUS.OUT_OF_ORDER]: 'Out of Order',
};

export const ROOM_CLEANING_STATUS_OPTIONS = Object.values(ROOM_CLEANING_STATUS).map(value => ({
  value: value, // Number
  label: ROOM_CLEANING_STATUS_TEXT[value as keyof typeof ROOM_CLEANING_STATUS_TEXT]
}));


// NOTIFICATION_STATUS: Integer values
export const NOTIFICATION_STATUS = {
  UNREAD: 0,
  READ: 1,
} as const;

export const NOTIFICATION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_STATUS.UNREAD]: 'Unread',
  [NOTIFICATION_STATUS.READ]: 'Read',
};

// NOTIFICATION_TRANSACTION_LINK_STATUS: Integer values
export const NOTIFICATION_TRANSACTION_LINK_STATUS = {
  NO_TRANSACTION_LINK: 0,
  TRANSACTION_LINKED: 1,
} as const;

export const NOTIFICATION_TRANSACTION_LINK_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_LINK_STATUS.NO_TRANSACTION_LINK]: 'No Linked Tx',
  [NOTIFICATION_TRANSACTION_LINK_STATUS.TRANSACTION_LINKED]: 'Reservation Linked', // Updated text
};


// TRANSACTION_LIFECYCLE_STATUS: Integer values
export const TRANSACTION_LIFECYCLE_STATUS = {
  CHECKED_IN: 0,                       // Guest is currently in the room. is_paid might be 0 or 1.
  CHECKED_OUT: 1,                      // Guest has departed, and bill is settled. is_paid should be 1.
  RESERVATION_WITH_ROOM: 2,            // Reservation confirmed and a specific room is assigned. is_paid can be 0, 1, or 2.
  RESERVATION_NO_ROOM: 3,              // Reservation made, but no specific room assigned yet (e.g., for a room type). is_paid can be 0, 1, or 2.
  PENDING_BRANCH_ACCEPTANCE: 4,        // Admin-created reservation awaiting branch action. is_paid can be 0, 1, or 2. is_accepted will be PENDING.
  ADMIN_RESERVATION_DECLINED: 5,       // Admin-created reservation declined by branch. is_paid irrelevant. is_accepted will be NOT_ACCEPTED.
  VOIDED_CANCELLED: 6,                 // Reservation or booking cancelled/voided. is_paid irrelevant.
} as const;

export const TRANSACTION_LIFECYCLE_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN]: 'Checked-In',
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT]: 'Checked-Out',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM]: 'Reservation (Room Assigned)',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM]: 'Reservation (No Room)',
  [TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE]: 'Pending Branch Acceptance',
  [TRANSACTION_LIFECYCLE_STATUS.ADMIN_RESERVATION_DECLINED]: 'Admin Reservation Declined',
  [TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED]: 'Voided/Cancelled',
};

// TRANSACTION_PAYMENT_STATUS: Integer values
export const TRANSACTION_PAYMENT_STATUS = {
  UNPAID: 0,
  PAID: 1,
  ADVANCE_PAID: 2, // For reservations paid in advance
} as const;

export const TRANSACTION_PAYMENT_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_PAYMENT_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_PAYMENT_STATUS.PAID]: 'Paid',
  [TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID]: 'Advance Paid',
};

// TRANSACTION_IS_ACCEPTED_STATUS: Integer values
export const TRANSACTION_IS_ACCEPTED_STATUS = {
    DEFAULT: 0,      // Not applicable or default state
    NOT_ACCEPTED: 1, // Declined by branch
    ACCEPTED: 2,     // Accepted by branch
    PENDING: 3,      // Pending branch action (for admin-created reservations)
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'N/A',
    [TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED]: 'Declined by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED]: 'Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.PENDING]: 'Pending Branch Action',
};

// LOST_AND_FOUND_STATUS: Integer values
export const LOST_AND_FOUND_STATUS = {
  FOUND: 0,
  CLAIMED: 1,
  DISPOSED: 2,
} as const;

export const LOST_AND_FOUND_STATUS_TEXT: { [key: number]: string } = {
  [LOST_AND_FOUND_STATUS.FOUND]: 'Found',
  [LOST_AND_FOUND_STATUS.CLAIMED]: 'Claimed',
  [LOST_AND_FOUND_STATUS.DISPOSED]: 'Disposed',
};

export const LOST_AND_FOUND_STATUS_OPTIONS = Object.values(LOST_AND_FOUND_STATUS).map(value => ({
  value: value, // Number
  label: LOST_AND_FOUND_STATUS_TEXT[value as keyof typeof LOST_AND_FOUND_STATUS_TEXT]
}));

    