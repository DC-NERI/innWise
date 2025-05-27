
// ROOM_AVAILABILITY_STATUS: Integer values
export const ROOM_AVAILABILITY_STATUS = {
  AVAILABLE: 0, // Room is structurally available (not occupied or reserved)
  OCCUPIED: 1,  // A guest is currently checked into this room
  RESERVED: 2,  // The room is held for a future guest arrival
} as const;

export const ROOM_AVAILABILITY_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_AVAILABILITY_STATUS.AVAILABLE]: 'Available',
  [ROOM_AVAILABILITY_STATUS.OCCUPIED]: 'Occupied',
  [ROOM_AVAILABILITY_STATUS.RESERVED]: 'Reserved',
};

// HOTEL_ENTITY_STATUS: String values for general entity status (active, archived, etc.)
// Used for tenants, users, branches, rates, room definitions
export const HOTEL_ENTITY_STATUS = {
  ARCHIVED: '0',
  ACTIVE: '1',
  SUSPENDED: '2', // For tenants
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
  value: value.toString(), // Ensure value is string for SelectItem
  label: ROOM_CLEANING_STATUS_TEXT[value as keyof typeof ROOM_CLEANING_STATUS_TEXT]
}));


// NOTIFICATION_STATUS (Read/Unread for notifications table) - Integers ('0' or '1' as strings from DB, convert to number)
export const NOTIFICATION_STATUS = {
  UNREAD: 0,
  READ: 1,
} as const;

export const NOTIFICATION_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_STATUS.UNREAD]: 'Unread',
  [NOTIFICATION_STATUS.READ]: 'Read',
};

// NOTIFICATION_TRANSACTION_LINK_STATUS (Whether a notification is linked to a transaction) - Integers
export const NOTIFICATION_TRANSACTION_LINK_STATUS = {
  NO_TRANSACTION_LINK: 0,
  TRANSACTION_LINKED: 1, // Admin has acted on this notification to create a reservation
} as const;

export const NOTIFICATION_TRANSACTION_LINK_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_LINK_STATUS.NO_TRANSACTION_LINK]: 'No Linked Tx',
  [NOTIFICATION_TRANSACTION_LINK_STATUS.TRANSACTION_LINKED]: 'Reservation Linked',
};

// TRANSACTION_LIFECYCLE_STATUS (Status of a transaction record) - Integers
// From DDL: 0:check-in, 1:check-out, 2:reservation w/ room, 3:reservation w/o room, 4:admin reservation, 5:declined admin res, 6:voided
export const TRANSACTION_LIFECYCLE_STATUS = {
  CHECKED_IN: 0,                      // Staff makes a booking/walk-in for an available room, or checks in an accepted reservation.
  CHECKED_OUT: 1,                     // Guest has checked out and transaction is completed & paid.
  RESERVATION_WITH_ROOM: 2,         // Staff reserves a specific room for a guest (not yet checked in).
  RESERVATION_NO_ROOM: 3,           // Staff creates a reservation without assigning a specific room yet, OR an admin reservation that staff accepted.
  PENDING_BRANCH_ACCEPTANCE: 4,     // Admin created reservation, needs branch action.
  ADMIN_RESERVATION_DECLINED: 5,    // Admin-created reservation explicitly DECLINED by branch.
  VOIDED_CANCELLED: 6,              // Voided/cancelled by staff/admin (general cancellation).
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

// TRANSACTION_PAYMENT_STATUS (is_paid column in transactions table) - Integers
// From DDL: 0:unpaid, 1:paid, 2:advance paid
export const TRANSACTION_PAYMENT_STATUS = {
  UNPAID: 0,
  PAID: 1,
  ADVANCE_PAID: 2, // Guest paid in advance for a reservation
} as const;

export const TRANSACTION_PAYMENT_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_PAYMENT_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_PAYMENT_STATUS.PAID]: 'Paid',
  [TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID]: 'Advance Paid',
};

// TRANSACTION_IS_ACCEPTED_STATUS (is_accepted column in transactions, for admin-created ones) - Integers
// From DDL: 0:Default, 1:Not Accepted, 2:Accepted, 3:Pending
export const TRANSACTION_IS_ACCEPTED_STATUS = {
    DEFAULT: 0,         // Typically for staff-created transactions that don't need explicit branch acceptance.
    NOT_ACCEPTED: 1,    // Declined by branch.
    ACCEPTED: 2,        // Accepted by branch.
    PENDING: 3,         // Pending branch action (for admin-created reservations with lifecycle status PENDING_BRANCH_ACCEPTANCE).
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'N/A (Staff Created)',
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
  value: value.toString(),
  label: LOST_AND_FOUND_STATUS_TEXT[value as keyof typeof LOST_AND_FOUND_STATUS_TEXT]
}));

// LOGIN_LOG_STATUS (0 for failed, 1 for success)
export const LOGIN_LOG_STATUS = {
  FAILED: 0,
  SUCCESS: 1,
} as const;

export const LOGIN_LOG_STATUS_TEXT: { [key: number]: string } = {
  [LOGIN_LOG_STATUS.FAILED]: 'Failed',
  [LOGIN_LOG_STATUS.SUCCESS]: 'Success',
};
