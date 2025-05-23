
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

export const TRANSACTION_LIFECYCLE_STATUS = {
  CHECKED_IN: 0, // Occupied, initial bill possibly paid or unpaid
  CHECKED_OUT: 1, // Stay completed and fully paid
  RESERVATION_WITH_ROOM: 2, // Room assigned, paid in advance, awaiting check-in
  RESERVATION_NO_ROOM: 3, // No room assigned, paid in advance or for future, awaiting room assignment
  PENDING_BRANCH_ACCEPTANCE: 4, // Admin created, needs branch action
  // RESERVATION_DECLINED: 5, // This state can be achieved by setting is_accepted to NOT_ACCEPTED and status to VOIDED_CANCELLED
  VOIDED_CANCELLED: 6,
  // Re-using 2 and 3 for specific types of reservations:
  ADVANCE_PAID: 2, // Alias for RESERVATION_WITH_ROOM when is_paid=2 implies full rate paid
  ADVANCE_RESERVATION: 3, // Alias for RESERVATION_NO_ROOM when it's a future booking, possibly not paid
} as const;

export const TRANSACTION_LIFECYCLE_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_IN]: 'Checked-In',
  [TRANSACTION_LIFECYCLE_STATUS.CHECKED_OUT]: 'Checked-Out',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_WITH_ROOM]: 'Reservation (Room Assigned)',
  [TRANSACTION_LIFECYCLE_STATUS.RESERVATION_NO_ROOM]: 'Reservation (No Room Yet)',
  [TRANSACTION_LIFECYCLE_STATUS.PENDING_BRANCH_ACCEPTANCE]: 'Pending Branch Acceptance',
  [TRANSACTION_LIFECYCLE_STATUS.VOIDED_CANCELLED]: 'Voided/Cancelled',
};


export const TRANSACTION_PAYMENT_STATUS = {
  UNPAID: 0,
  PAID: 1, // Fully paid for the stay (usually at checkout, or if check-in covers full rate initially)
  ADVANCE_PAID: 2, // An advance payment was made (e.g., for a reservation)
} as const;

export const TRANSACTION_PAYMENT_STATUS_TEXT: { [key: number]: string } = {
  [TRANSACTION_PAYMENT_STATUS.UNPAID]: 'Unpaid',
  [TRANSACTION_PAYMENT_STATUS.PAID]: 'Paid',
  [TRANSACTION_PAYMENT_STATUS.ADVANCE_PAID]: 'Advance Paid',
};

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
