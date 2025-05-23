
export const ROOM_AVAILABILITY_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2, // This status on hotel_room is set when a transaction's status is RESERVATION_WITH_ROOM or PENDING_BRANCH_ACCEPTANCE
} as const;

export const ROOM_AVAILABILITY_STATUS_TEXT: { [key: number]: string } = {
  [ROOM_AVAILABILITY_STATUS.AVAILABLE]: 'Available',
  [ROOM_AVAILABILITY_STATUS.OCCUPIED]: 'Occupied',
  [ROOM_AVAILABILITY_STATUS.RESERVED]: 'Reserved',
};

export const HOTEL_ENTITY_STATUS = {
  ARCHIVED: '0',
  ACTIVE: '1',
} as const;

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
  value: value,
  label: ROOM_CLEANING_STATUS_TEXT[value as keyof typeof ROOM_CLEANING_STATUS_TEXT]
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
  NO_TRANSACTION_LINK: 0,
  TRANSACTION_LINKED: 1,
} as const;

export const NOTIFICATION_TRANSACTION_LINK_STATUS_TEXT: { [key: number]: string } = {
  [NOTIFICATION_TRANSACTION_LINK_STATUS.NO_TRANSACTION_LINK]: 'No Linked Tx',
  [NOTIFICATION_TRANSACTION_LINK_STATUS.TRANSACTION_LINKED]: 'Tx Linked',
};

// Based on user's DDL for transactions.status:
// 0: check-in
// 1: check-out
// 2: reservation w/ room assignment
// 3: reservation w/ no room assignment
// 4: reservation transaction made by admin (PENDING_BRANCH_ACCEPTANCE)
// 5: declined reservation from admin
// 6: voided/cancelled reservation
export const TRANSACTION_LIFECYCLE_STATUS = {
  CHECKED_IN: 0,
  CHECKED_OUT: 1,
  RESERVATION_WITH_ROOM: 2, // Staff created reservation, room assigned
  RESERVATION_NO_ROOM: 3,   // Staff created reservation, no room assigned yet
  PENDING_BRANCH_ACCEPTANCE: 4, // Admin created reservation, awaiting branch action
  ADMIN_RESERVATION_DECLINED: 5, // Admin created reservation, declined by branch
  VOIDED_CANCELLED: 6,
} as const;

export const TRANSACTION_LIFECYCLE_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN]: 'Checked-In',
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT]: 'Checked-Out',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM]: 'Reservation (Room Assigned)',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM]: 'Reservation (No Room Yet)',
  [TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE]: 'Pending Branch Acceptance',
  [TRANSACTION_LIFECYCLE_STATUS.ADMIN_RESERVATION_DECLINED]: 'Admin Reservation Declined',
  [TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED]: 'Voided/Cancelled',
};


// Based on user's DDL for transactions.is_paid:
// 0: unpaid
// 1: paid
// 2: advance paid
export const TRANSACTION_PAYMENT_STATUS = {
  UNPAID: 0,
  PAID: 1,
  ADVANCE_PAID: 2,
} as const;

export const TRANSACTION_PAYMENT_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_PAYMENT_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_PAYMENT_STATUS.PAID]: 'Paid',
  [TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID]: 'Advance Paid',
};

// Based on user's DDL for transactions.is_accepted:
// 0 = Default
// 1 = Not Accepted
// 2 = Accepted
// 3 = Pending
export const TRANSACTION_IS_ACCEPTED_STATUS = {
    DEFAULT: 0,
    NOT_ACCEPTED: 1,
    ACCEPTED: 2,
    PENDING: 3,
} as const;

export const TRANSACTION_IS_ACCEPTED_STATUS_TEXT: { [key: number]: string} = {
    [TRANSACTION_IS_ACCEPTED_STATUS.DEFAULT]: 'N/A',
    [TRANSACTION_IS_ACCEPTED_STATUS.NOT_ACCEPTED]: 'Declined by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.ACCEPTED]: 'Accepted by Branch',
    [TRANSACTION_IS_ACCEPTED_STATUS.PENDING]: 'Pending Branch Action',
};


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
  value: value,
  label: LOST_AND_FOUND_STATUS_TEXT[value as keyof typeof LOST_AND_FOUND_STATUS_TEXT]
}));
